import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabase'
import { exportarExcel } from '../exportUtils'

/* ══════════════════════════════════════════════════════════════════════
   CIERRE DIARIO — cuadratura y trazabilidad
   Compara, para un día y sucursal: lo que registró el POS documento por
   documento (con sus medios de pago) contra lo que declaró el cajero.
   Además detecta los huecos de trazabilidad: documentos sin pago, pagos
   sin documento, y documentos cuyo total no calza con sus pagos.
   RPC: fn_tes_cierre_dias · fn_tes_cierre_dia · fn_tes_cierre_huecos
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB'
const fmt = n => '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fS = n => new Intl.NumberFormat('es-CL').format(Number(n || 0))
const TH = { textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: SLATE, padding: '7px 9px', borderBottom: `1px solid ${NAVY}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff', zIndex: 2 }
const TD = { fontSize: 12.5, padding: '6px 9px', borderBottom: '1px solid #F3F4F6', whiteSpace: 'nowrap' }
const NUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }
const INPUT = { fontSize: 12, padding: '5px 8px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff' }
const EST = { cuadra: VERDE, tolerable: AMBAR, descuadre: ROJO, sin_cierre: SLATE }
const EST_L = { cuadra: 'Cuadra', tolerable: 'Tolerable', descuadre: 'Descuadre', sin_cierre: 'Sin cierre' }
const hoyISO = () => new Date().toISOString().slice(0, 10)
const menos = d => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10) }

function Bloque({ titulo, sub, acciones, children }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '11px 15px', borderBottom: `1px solid ${BORDE}`, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{titulo}</div>
          {sub && <div style={{ fontSize: 11.5, color: SLATE, marginTop: 2, lineHeight: 1.45 }}>{sub}</div>}
        </div>
        {acciones}
      </div>
      <div style={{ padding: 13 }}>{children}</div>
    </div>
  )
}

export function CierreCuadraturaTab() {
  const [desde, setDesde] = useState(menos(30))
  const [hasta, setHasta] = useState(hoyISO())
  const [fSuc, setFSuc] = useState('')
  const [sucursales, setSucursales] = useState([])
  const [dias, setDias] = useState([])
  const [sel, setSel] = useState(null)          // { fecha, sucursal_id }
  const [det, setDet] = useState(null)
  const [huecos, setHuecos] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [verDocs, setVerDocs] = useState(false)
  const [soloProblema, setSoloProblema] = useState(false)
  const [error, setError] = useState(null)

  const cargarDias = useCallback(async () => {
    setCargando(true); setError(null)
    const [r, f] = await Promise.all([
      supabase.rpc('fn_tes_cierre_dias', { p_desde: desde, p_hasta: hasta, p_sucursal: fSuc || null }),
      supabase.rpc('fn_tes_filtros', { p_desde: desde, p_hasta: hasta }),
    ])
    setCargando(false)
    if (r.error) { setError(r.error.message); return }
    setDias(r.data ?? [])
    if (!f.error && f.data?.sucursales) setSucursales(f.data.sucursales)
  }, [desde, hasta, fSuc])
  useEffect(() => { cargarDias() }, [cargarDias])

  const abrirDia = async (d) => {
    setSel({ fecha: d.fecha, sucursal_id: d.sucursal_id }); setDet(null); setHuecos(null); setVerDocs(false)
    const [a, b] = await Promise.all([
      supabase.rpc('fn_tes_cierre_dia', { p_fecha: d.fecha, p_sucursal: d.sucursal_id }),
      supabase.rpc('fn_tes_cierre_huecos', { p_fecha: d.fecha, p_sucursal: d.sucursal_id }),
    ])
    if (a.error) { setError(a.error.message); return }
    setDet(a.data); setHuecos(b.error ? null : b.data)
  }

  const vista = soloProblema ? dias.filter(d => d.estado !== 'cuadra' || Number(d.abono_no_declarado) !== 0) : dias
  const tot = dias.reduce((a, d) => ({
    dif: a.dif + Math.abs(Number(d.dif || 0)),
    abono: a.abono + Number(d.abono_no_declarado || 0),
    desc: a.desc + (d.estado === 'descuadre' ? 1 : 0),
    sc: a.sc + (d.estado === 'sin_cierre' ? 1 : 0),
  }), { dif: 0, abono: 0, desc: 0, sc: 0 })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={INPUT} />
        <span style={{ color: SLATE, fontSize: 12 }}>a</span>
        <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={INPUT} />
        <select value={fSuc} onChange={e => setFSuc(e.target.value)} style={INPUT}>
          <option value="">Todas las sucursales</option>
          {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={soloProblema} onChange={e => setSoloProblema(e.target.checked)} />
          Solo días con algo que revisar
        </label>
        <span style={{ fontSize: 11, color: SLATE, marginLeft: 'auto' }}>{cargando ? 'cargando…' : `${fS(dias.length)} días`}</span>
      </div>

      {error && <div style={{ background: '#FEF3F2', border: '1px solid #FECDCA', borderRadius: 8, padding: 12, color: ROJO, fontSize: 12.5 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {[
          { l: 'Días con descuadre', v: fS(tot.desc), s: `de ${fS(dias.length)} días`, c: tot.desc ? ROJO : VERDE },
          { l: 'Diferencia acumulada', v: fmt(tot.dif), s: 'POS contra lo declarado', c: tot.dif > 0 ? AMBAR : VERDE },
          { l: 'Abono no declarado', v: fmt(tot.abono), s: 'pagado con saldo, sin registrar en caja', c: tot.abono > 0 ? ROJO : VERDE },
          { l: 'Días sin cierre', v: fS(tot.sc), s: 'hubo venta y nadie cerró', c: tot.sc ? ROJO : VERDE },
        ].map((k, i) => (
          <div key={i} style={{ background: '#fff', border: `1px solid ${BORDE}`, borderLeft: `4px solid ${k.c}`, borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, letterSpacing: 0.5, color: SLATE, fontWeight: 700 }}>{k.l}</div>
            <div style={{ fontSize: 19, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: k.c }}>{k.v}</div>
            <div style={{ fontSize: 10.5, color: SLATE }}>{k.s}</div>
          </div>
        ))}
      </div>

      <Bloque titulo="Cierre día por día" sub="Clic en un día abre su trazabilidad completa: cada boleta y factura con el medio con que se pagó."
        acciones={<button onClick={() => exportarExcel(dias, `cierres_${desde}`, 'Cierres')} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>}>
        <div style={{ maxHeight: '40vh', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Fecha</th><th style={TH}>Sucursal</th>
              <th style={{ ...TH, textAlign: 'right' }}>Docs</th>
              <th style={{ ...TH, textAlign: 'right' }}>POS recaudó</th>
              <th style={{ ...TH, textAlign: 'right' }}>Caja declaró</th>
              <th style={{ ...TH, textAlign: 'right' }}>Diferencia</th>
              <th style={{ ...TH, textAlign: 'right' }}>Abono sin declarar</th>
              <th style={TH}>Estado</th>
            </tr></thead>
            <tbody>
              {vista.map((d, i) => (
                <tr key={i} onClick={() => abrirDia(d)} style={{ cursor: 'pointer', background: sel?.fecha === d.fecha && sel?.sucursal_id === d.sucursal_id ? '#F0F4FF' : undefined }}>
                  <td style={{ ...TD, fontWeight: 600, textDecoration: 'underline dotted #C7D2FE' }}>{d.fecha}</td>
                  <td style={TD}>{d.sucursal ?? d.sucursal_id}</td>
                  <td style={NUM}>{fS(d.n_docs)}</td>
                  <td style={NUM}>{fmt(d.recaudacion)}</td>
                  <td style={NUM}>{fmt(d.declarado)}</td>
                  <td style={{ ...NUM, fontWeight: 700, color: Math.abs(Number(d.dif)) <= 2000 ? SLATE : Math.abs(Number(d.dif)) <= 20000 ? AMBAR : ROJO }}>{fmt(d.dif)}</td>
                  <td style={{ ...NUM, color: Number(d.abono_no_declarado) > 0 ? ROJO : SLATE }}>{Number(d.abono_no_declarado) > 0 ? fmt(d.abono_no_declarado) : '—'}</td>
                  <td style={{ ...TD, fontSize: 11, fontWeight: 700, color: EST[d.estado] }}>{EST_L[d.estado]}</td>
                </tr>
              ))}
              {!vista.length && <tr><td colSpan={8} style={{ ...TD, textAlign: 'center', color: SLATE, padding: 18 }}>Sin días en el filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </Bloque>

      {/* detalle del día seleccionado */}
      {sel && (
        <Bloque titulo={`${sel.fecha} · ${det?.sucursal ?? sel.sucursal_id}`}
          sub={det ? `${fS(det.resumen?.n_docs)} documentos · ${fS(det.resumen?.n_mixtos)} con pago mixto · estado del cierre: ${det.declarado?.estados ?? 'sin cierre'}` : 'Cargando…'}
          acciones={det && <>
            <button onClick={() => setVerDocs(v => !v)} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>{verDocs ? 'Ocultar documentos' : 'Ver documentos'}</button>
            <button onClick={() => exportarExcel(det.documentos ?? [], `docs_${sel.fecha}_${sel.sucursal_id}`, 'Documentos')} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>
          </>}>
          {!det ? <div style={{ color: SLATE, fontSize: 13 }}>Cargando…</div> : (
            <>
              {/* comparativo por medio */}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                <thead><tr>
                  <th style={TH}>Medio de pago</th>
                  <th style={{ ...TH, textAlign: 'right' }}>POS (BSALE)</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Caja declaró</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Diferencia</th>
                  <th style={TH}>Lectura</th>
                </tr></thead>
                <tbody>
                  {(det.comparativo ?? []).map((c, i) => (
                    <tr key={i} style={{ background: c.fisico && Math.abs(Number(c.dif)) > 1000 ? '#FEF3F2' : undefined }}>
                      <td style={{ ...TD, fontWeight: 600 }}>{c.medio}{c.no_recauda ? <span style={{ fontSize: 9.5, color: SLATE, fontWeight: 400 }}> · no recauda</span> : null}</td>
                      <td style={NUM}>{fmt(c.bsale)}</td>
                      <td style={NUM}>{fmt(c.declarado)}</td>
                      <td style={{ ...NUM, fontWeight: 700, color: Math.abs(Number(c.dif)) <= 1000 ? SLATE : c.fisico ? ROJO : AMBAR }}>{fmt(c.dif)}</td>
                      <td style={{ ...TD, fontSize: 11, color: SLATE, whiteSpace: 'normal', maxWidth: 330 }}>
                        {Math.abs(Number(c.dif)) <= 1000 ? 'Calza' :
                          c.fisico ? 'Diferencia en efectivo: es lo único físico, revisar primero' :
                          c.no_recauda ? 'El POS registra pagos con saldo del cliente que el cierre no declara' :
                          'Revisar la declaración del turno para este medio'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* huecos de trazabilidad */}
              {huecos && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8, marginBottom: 12 }}>
                  {[
                    { l: 'Documentos sin pago registrado', d: huecos.docs_sin_pago, n: 'Se emitió el documento pero no hay cobro asociado' },
                    { l: 'Pagos sin documento tributario', d: huecos.pagos_sin_doc, n: 'Se cobró sin boleta ni factura enlazada' },
                    { l: 'Documentos que no calzan con sus pagos', d: huecos.doc_descuadrado, n: 'El total del documento difiere de lo pagado' },
                  ].map((h, i) => (
                    <div key={i} style={{ border: `1px solid ${BORDE}`, borderLeft: `4px solid ${Number(h.d?.n) > 0 ? AMBAR : VERDE}`, borderRadius: 6, padding: '9px 12px' }}>
                      <div style={{ fontSize: 11, color: SLATE, fontWeight: 600 }}>{h.l}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: Number(h.d?.n) > 0 ? AMBAR : VERDE }}>
                        {fS(h.d?.n ?? 0)} <span style={{ fontSize: 12, color: SLATE }}>· {fmt(h.d?.monto ?? 0)}</span>
                      </div>
                      <div style={{ fontSize: 10.5, color: SLATE, lineHeight: 1.4 }}>{h.n}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* trazabilidad documento por documento */}
              {verDocs && (
                <div style={{ maxHeight: '46vh', overflow: 'auto', border: `1px solid ${BORDE}`, borderRadius: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>
                      <th style={TH}>Documento</th><th style={TH}>Cliente</th><th style={TH}>Cajero</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Total doc</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Efectivo</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Tarjetas</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Webpay</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Transf.</th>
                      <th style={{ ...TH, textAlign: 'right' }}>Abono</th>
                      <th style={TH}>Medios</th>
                    </tr></thead>
                    <tbody>
                      {(det.documentos ?? []).map((x, i) => (
                        <tr key={i} style={{ background: x.descuadra ? '#FFFBEB' : x.anulado ? '#F3F4F6' : undefined }}>
                          <td style={{ ...TD, fontWeight: 600 }}>{x.tipo ?? 'Doc'} {x.folio ?? ''}{x.anulado ? ' (anulado)' : ''}</td>
                          <td style={{ ...TD, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.cliente ?? '—'}</td>
                          <td style={{ ...TD, fontSize: 11 }}>{x.cajero}</td>
                          <td style={{ ...NUM, fontWeight: 700 }}>{fmt(x.doc_total ?? x.pagado)}</td>
                          <td style={NUM}>{Number(x.efectivo) ? fmt(x.efectivo) : ''}</td>
                          <td style={NUM}>{Number(x.tarjetas) ? fmt(x.tarjetas) : ''}</td>
                          <td style={NUM}>{Number(x.online) ? fmt(x.online) : ''}</td>
                          <td style={NUM}>{Number(x.transferencia) ? fmt(x.transferencia) : ''}</td>
                          <td style={{ ...NUM, color: Number(x.abono) ? ROJO : INK }}>{Number(x.abono) ? fmt(x.abono) : ''}</td>
                          <td style={{ ...TD, fontSize: 10.5, color: SLATE, whiteSpace: 'normal', maxWidth: 200 }}>
                            {x.medios}{x.mixto ? <span style={{ color: AMBAR, fontWeight: 700 }}> · mixto</span> : null}
                            {x.descuadra ? <span style={{ color: AMBAR, fontWeight: 700 }}> · dif {fmt(x.dif)}</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Bloque>
      )}
    </div>
  )
}

export default CierreCuadraturaTab
