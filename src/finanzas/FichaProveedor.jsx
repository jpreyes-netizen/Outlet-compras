import { useEffect, useMemo, useState } from 'react'
import { FileText, X, ExternalLink } from 'lucide-react'
import { supabase } from '../supabase'

/* ═══════════════════════════════════════════════════════════════════════
   FICHA DEL PROVEEDOR (27-oct-2026) — Imputar facturas
   Se abre al hacer clic en el nombre del proveedor (pestañas Proveedores y
   Facturas). Reúne lo necesario para decidir cómo clasificarlo:
   · su regla actual (subcuenta, centro, plazo) con botones para cambiarla o
     confirmarla;
   · la evidencia: cómo se pagaron sus facturas en el banco, cómo se clasifican
     en el banco los movimientos con su nombre y cómo están sus facturas;
   · sus facturas, con vista previa del PDF (BSALE) en la misma ficha.
   Esc o la ✕ la cierran. Los cambios se guardan con las mismas funciones de la
   pantalla, así que la ficha se actualiza sola.
   ═══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', BORDE = '#E5E7EB', VERDE = '#1E7A44', AMBAR = '#B25E09', ROJO = '#B42318', AZUL = '#1D4ED8', MORADO = '#6D28D9'
const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontVariantNumeric: 'tabular-nums' }
const fmt = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const fmtM = n => { const v = Number(n || 0); return Math.abs(v) >= 1e6 ? `$${(v / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 })}M` : `$${fmt(v)}` }
const fF = f => { if (!f) return ''; const [a, m, d] = String(f).slice(0, 10).split('-'); return `${d}-${m}-${String(a).slice(2)}` }
const fRut = r => { const s = String(r || ''); return s.length > 1 ? `${s.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${s.slice(-1)}` : s }
const TIPO = c => (c === '61' ? 'NC' : c === '56' ? 'ND' : c === '914' ? 'DIN' : 'F')
const BTN = { fontSize: 11.5, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', color: NAVY, cursor: 'pointer' }
const SEC = { fontSize: 10.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4, margin: '14px 0 6px' }

export function FichaProveedor({ prov, facturas, estados, estadoProv, estadoFact, procesando,
  onClose, onAbrirDte, onCambiarSubcuenta, onCambiarCentro, onConfirmar, onIrAFacturas, onPedirIA }) {
  const [evid, setEvid] = useState(null)
  const [verTodas, setVerTodas] = useState(false)
  const [pdf, setPdf] = useState({ id: null, url: null, cargando: false })

  useEffect(() => {
    let vivo = true
    setEvid(null)
    supabase.rpc('fn_ficha_proveedor', { p_rut: prov.rut }).then(({ data, error }) => { if (vivo) setEvid(error ? { error: error.message } : (data ?? {})) })
    return () => { vivo = false }
  }, [prov.rut])
  useEffect(() => {
    const h = e => { if (e.key === 'Escape' && !document.querySelector('[data-combo-popup]')) onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const ordenadas = useMemo(() => [...facturas].sort((a, b) => String(b.fecha_emision).localeCompare(String(a.fecha_emision))), [facturas])
  const pendientes = ordenadas.filter(f => estadoFact(f) !== 'imputada')
  const lista = verTodas || !pendientes.length ? ordenadas : pendientes
  const hist = useMemo(() => {
    const m = new Map()
    for (const f of facturas) {
      if (!f.subcuenta_codigo) continue
      const k = `${f.subcuenta_codigo} ${f.subcuenta_nombre}${f.centro_codigo ? ` · ${f.centro_codigo} ${f.centro_nombre}` : ''}`
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [facturas])

  async function previsualizar(f) {
    setPdf({ id: f.id, url: null, cargando: true })
    const { data, error } = await supabase.from('libro_compras').select('url_pdf').eq('id', f.id).single()
    setPdf({ id: f.id, url: error ? null : (data?.url_pdf ?? null), cargando: false })
  }

  const ep = estadoProv(prov), info = estados.prov[ep] ?? {}
  const porFactura = prov.modo_centro === 'por_factura'
  const facturaPrevia = ordenadas.find(f => f.id === pdf.id)

  const Regla = ({ titulo, valor, detalle, falta, onCambiar, ayuda }) => (
    <div title={ayuda} style={{ flex: '1 1 0', minWidth: 160, border: `1px solid ${falta ? '#FECACA' : BORDE}`, background: falta ? '#FEF2F2' : '#fff', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4 }}>{titulo}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: falta ? ROJO : INK, marginTop: 2 }}>{valor}</div>
      {detalle && <div style={{ fontSize: 10.5, color: SLATE, marginTop: 1 }}>{detalle}</div>}
      {onCambiar && <button onClick={e => onCambiar(e.currentTarget.getBoundingClientRect())} disabled={!!procesando} style={{ ...BTN, marginTop: 6, padding: '2px 8px', fontSize: 11 }}>Cambiar</button>}
    </div>
  )
  const Fila = ({ izq, der, title, color }) => (
    <div title={title} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, padding: '3px 0', borderBottom: '1px dashed #EEF0F3' }}>
      <span style={{ flex: 1, minWidth: 0, color: color ?? INK }}>{izq}</span><span style={{ ...MONO, fontSize: 11.5, color: SLATE, whiteSpace: 'nowrap' }}>{der}</span>
    </div>
  )

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.18)', zIndex: 240 }} />
      <div role="dialog" aria-label={`Ficha de ${prov.razon_social}`}
        style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(780px, 60vw)', minWidth: 520, background: '#F8FAFC', borderLeft: `1px solid ${BORDE}`, boxShadow: '-10px 0 28px rgba(0,0,0,0.14)', zIndex: 250, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px', background: '#fff', borderBottom: `1px solid ${BORDE}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: NAVY }}>{prov.razon_social}</div>
            <div style={{ fontSize: 11.5, color: SLATE, marginTop: 2 }}>
              RUT {fRut(prov.rut)} · <b style={{ color: info.c ?? SLATE }} title={info.desc}>{info.l ?? ep}</b>
              {porFactura && <> · <b style={{ color: AZUL }} title="Cada factura elige su centro de costo">centro por factura</b></>}
            </div>
          </div>
          {ep === 'por_confirmar' && (
            <button onClick={onConfirmar} disabled={!!procesando} title="Confirma la subcuenta y el centro que muestra el proveedor"
              style={{ ...BTN, background: VERDE, color: '#fff', border: 'none' }}>✓ Confirmar subcuenta y centro</button>
          )}
          <button onClick={onClose} title="Cerrar (Esc)" aria-label="Cerrar" style={{ ...BTN, padding: '4px 8px' }}><X size={14} /></button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '4px 16px 16px' }}>
          <div style={SEC}>Regla del proveedor (se aplica a todas sus facturas)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Regla titulo="Subcuenta" ayuda="Subcuenta del plan único (la misma del banco). Define la cuenta contable de sus facturas."
              valor={prov.subcuenta_codigo ? `${prov.subcuenta_codigo} ${prov.subcuenta_nombre}` : 'Falta elegir'}
              detalle={prov.cuenta ? `cuenta contable ${prov.cuenta} ${prov.cuenta_nombre ?? ''}` : 'sin cuenta contable'} falta={!prov.subcuenta_codigo} onCambiar={onCambiarSubcuenta} />
            <Regla titulo="Centro de costo" ayuda="Área y sede a la que va el gasto. «Por factura» = cada factura elige el suyo."
              valor={porFactura ? 'Por factura' : prov.centro_codigo ? `${prov.centro_codigo} ${prov.centro_nombre}` : 'Falta elegir'}
              detalle={porFactura ? 'cada factura elige su centro' : prov.centro_origen && String(prov.centro_origen).includes('sugerido') ? 'sugerido: confírmalo' : prov.ceco_nombre ? `sede ${prov.ceco_nombre}` : null}
              falta={!porFactura && !prov.centro_codigo && prov.requiere_centro !== false} onCambiar={onCambiarCentro} />
            <Regla titulo="Plazo de pago" ayuda="Días de crédito: define el vencimiento de sus facturas." valor={`${prov.plazo_efectivo ?? 30} días`}
              detalle={prov.plazo_credito_dias == null ? 'por defecto (sin definir)' : 'definido'} />
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 12 }}>
            <span title="Facturas de 2026 sin notas de crédito"><b style={MONO}>{facturas.filter(f => f.codigo_sii !== '61').length}</b> facturas</span>
            <span title="Total facturado en 2026 con IVA"><b style={MONO}>{fmtM(prov.monto_ytd)}</b> en 2026</span>
            <span title="Facturas suyas que aún no están imputadas" style={{ color: pendientes.length ? AMBAR : VERDE }}><b style={MONO}>{pendientes.length}</b> por imputar</span>
            <span title="Facturas por pagar, descontadas las notas de crédito"><b style={MONO}>{fmtM(prov.saldo_abierto)}</b> saldo abierto</span>
          </div>

          <div style={SEC}>Cómo lo clasificas tú (la mejor pista para decidir)</div>
          <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '8px 12px' }}>
            {!evid && <div style={{ fontSize: 12, color: SLATE }}>Buscando en el banco…</div>}
            {evid?.error && <div style={{ fontSize: 12, color: ROJO }}>{evid.error}</div>}
            {evid && !evid.error && (
              <>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: NAVY, marginBottom: 2 }} title="Pagos del banco vinculados a sus facturas, con la subcuenta y el centro que les pusiste">Sus pagos en el banco</div>
                {(evid.pagos_en_banco ?? []).length === 0
                  ? <div style={{ fontSize: 11.5, color: SLATE }}>Sin pagos directos vinculados (puede pagarse en transferencias masivas o con tarjeta).</div>
                  : evid.pagos_en_banco.map((r, i) => <Fila key={i} title="Así clasificaste en el banco los pagos de sus facturas"
                      izq={<><b style={MONO}>{r.codigo ?? '—'}</b> {r.nombre ?? 'sin subcuenta'}{r.centro_codigo ? <span style={{ color: SLATE }}> · {r.centro_codigo} {r.centro_nombre}</span> : ''}</>}
                      der={`${r.n} pago${r.n === 1 ? '' : 's'} · ${fmtM(r.monto)}`} />)}
                {evid.palabra && (
                  <>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: NAVY, margin: '8px 0 2px' }} title="Compras con tarjeta, pagos en línea y transferencias cuya glosa contiene el nombre del proveedor">Movimientos del banco con «{evid.palabra}»</div>
                    {(evid.banco_por_nombre ?? []).length === 0
                      ? <div style={{ fontSize: 11.5, color: SLATE }}>Ninguno clasificado.</div>
                      : evid.banco_por_nombre.map((r, i) => <Fila key={i} title={`Ejemplo: ${r.ejemplo}`}
                          izq={<><b style={MONO}>{r.codigo}</b> {r.nombre}</>} der={`${r.n} movimiento${r.n === 1 ? '' : 's'}`} />)}
                  </>
                )}
                <div style={{ fontSize: 11.5, fontWeight: 700, color: NAVY, margin: '8px 0 2px' }} title="Cómo están imputadas hoy sus facturas">Sus facturas hoy</div>
                {hist.length === 0
                  ? <div style={{ fontSize: 11.5, color: SLATE }}>Ninguna factura tiene subcuenta todavía.</div>
                  : hist.map(([k, n]) => <Fila key={k} izq={k} der={`${n} factura${n === 1 ? '' : 's'}`} />)}
              </>
            )}
          </div>

          <div style={{ ...SEC, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>Sus facturas · {lista.length}{lista !== ordenadas ? ` pendientes de ${ordenadas.length}` : ''}</span>
            {pendientes.length > 0 && (
              <button onClick={() => setVerTodas(v => !v)} style={{ ...BTN, textTransform: 'none', letterSpacing: 0 }} title="Alterna entre ver solo las pendientes o todas">
                {verTodas ? 'Solo pendientes' : 'Ver todas'}
              </button>
            )}
            {pendientes.length > 0 && (
              <button onClick={() => onPedirIA(pendientes.map(f => f.id))} disabled={!!procesando} title="Pide a la IA una propuesta para sus facturas pendientes"
                style={{ ...BTN, color: MORADO, background: '#F5F3FF', borderColor: '#DDD6FE', textTransform: 'none', letterSpacing: 0 }}>✦ IA para {Math.min(pendientes.length, 100)}</button>
            )}
            <button onClick={onIrAFacturas} title="Abre la pestaña Facturas filtrada por este proveedor, para trabajarlas en masa"
              style={{ ...BTN, textTransform: 'none', letterSpacing: 0 }}>Trabajarlas en Facturas →</button>
          </div>
          <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'auto', maxHeight: pdf.id ? 230 : 420 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {[['Fecha', 'Fecha de emisión'], ['Doc', 'Tipo y folio. Clic en el ícono para abrirla en pestaña nueva'], ['Neto', 'Monto neto sin IVA'], ['Subcuenta', 'Subcuenta del plan único'], ['Centro', 'Centro de costo'], ['Estado', 'Estado de la imputación']].map(([h, t]) => (
                    <th key={h} title={t} style={{ fontSize: 10.5, color: SLATE, textAlign: h === 'Neto' ? 'right' : 'left', padding: '6px 8px', borderBottom: `1px solid ${BORDE}`, position: 'sticky', top: 0, background: '#F8FAFC' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lista.map(f => {
                  const e = estadoFact(f), ei = estados.fact[e] ?? {}
                  const sel = pdf.id === f.id
                  return (
                    <tr key={f.id} onClick={() => previsualizar(f)} title="Clic para ver la factura aquí mismo"
                      style={{ cursor: 'pointer', background: sel ? '#EEF2FF' : '#fff', borderBottom: '1px solid #F1F2F4' }}>
                      <td style={{ fontSize: 11.5, padding: '5px 8px', whiteSpace: 'nowrap' }}>{fF(f.fecha_emision)}</td>
                      <td style={{ fontSize: 11.5, padding: '5px 8px', whiteSpace: 'nowrap' }}>
                        <button onClick={ev => { ev.stopPropagation(); onAbrirDte(f) }} title="Abrir el PDF en pestaña nueva"
                          style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: AZUL, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <FileText size={12} /> {TIPO(f.codigo_sii)} <b>{f.folio}</b>
                        </button>
                      </td>
                      <td style={{ fontSize: 11.5, padding: '5px 8px', textAlign: 'right', ...MONO, color: Number(f.monto_libro) < 0 ? ROJO : INK }}>{fmt(Number(f.monto_libro) < 0 ? -Math.abs(f.neto ?? 0) : f.neto)}</td>
                      <td style={{ fontSize: 11.5, padding: '5px 8px' }}>{f.subcuenta_codigo ? <><b style={MONO}>{f.subcuenta_codigo}</b> {f.subcuenta_nombre}</> : <span style={{ color: AMBAR }}>sin subcuenta</span>}</td>
                      <td style={{ fontSize: 11.5, padding: '5px 8px' }}>{f.centro_codigo ? `${f.centro_codigo} ${f.centro_nombre}` : <span style={{ color: f.requiere_centro === false ? SLATE : AMBAR }}>{f.requiere_centro === false ? 'no aplica' : 'sin centro'}</span>}</td>
                      <td style={{ fontSize: 11, padding: '5px 8px', fontWeight: 700, color: ei.c ?? SLATE }} title={ei.desc}>{ei.l ?? e}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {lista.length === 0 && <div style={{ padding: 12, fontSize: 12, color: SLATE }}>Este proveedor no tiene facturas en el período cargado.</div>}
          </div>

          {pdf.id && (
            <div style={{ marginTop: 10, background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: `1px solid ${BORDE}`, fontSize: 12 }}>
                <b style={{ color: NAVY }}>{facturaPrevia ? `${TIPO(facturaPrevia.codigo_sii)} ${facturaPrevia.folio} · ${fF(facturaPrevia.fecha_emision)}` : 'Documento'}</b>
                <span style={{ flex: 1, color: SLATE, fontSize: 11 }}>{pdf.url ? 'Documento desde BSALE. Si no se ve aquí, ábrelo en pestaña nueva.' : ''}</span>
                {pdf.url && <a href={pdf.url} target="_blank" rel="noopener noreferrer" title="Abrir el PDF en pestaña nueva" style={{ ...BTN, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}><ExternalLink size={12} /> Pestaña nueva</a>}
                <button onClick={() => setPdf({ id: null, url: null, cargando: false })} title="Cerrar la vista previa" style={{ ...BTN, padding: '3px 7px' }}><X size={12} /></button>
              </div>
              {pdf.cargando && <div style={{ padding: 14, fontSize: 12, color: SLATE }}>Cargando documento…</div>}
              {!pdf.cargando && !pdf.url && <div style={{ padding: 14, fontSize: 12, color: SLATE }}>Esta factura no tiene PDF en BSALE. Búscala por folio en el SII o pídela al proveedor.</div>}
              {!pdf.cargando && pdf.url && <iframe title="Vista previa de la factura" src={pdf.url} style={{ width: '100%', height: '62vh', border: 'none', display: 'block' }} />}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
