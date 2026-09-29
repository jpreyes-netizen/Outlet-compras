import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { exportarExcel, exportarPDF } from './exportUtils'

/* ══════════════════════════════════════════════════════════════════════
   FUENTE DEL DATO — drawer genérico
   Cualquier módulo puede abrir la fuente de un número:
     const [det, setDet] = useState(null)
     abrirFuente(setDet, { titulo, sub, query })   // query: builder supabase
     <FuenteDrawer det={det} onClose={() => setDet(null)} />
   Columnas automáticas, total de la columna de monto si existe,
   exportación a Excel y PDF integrada.
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', SLATE = '#6E6E73', BORDE = '#E5E7EB'
const fmt = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))

/* ─── ORIGEN DE UN ASIENTO ───
   Muestra los documentos fuente que generaron el asiento (factura, movimiento de cartola, salidas de inventario,
   documentos de venta, costo por sucursal, liquidaciones...) y dónde se corrige. Datos: fn_origen_asiento. */
const DONDE_CORREGIR = {
  libro_compras: 'Compras y pagos › Imputar facturas (cuenta y centro de costo de la factura) o la regla del proveedor.',
  movimientos_bancarios: 'Bancos › Conciliar movimientos (clasificación del movimiento y facturas vinculadas).',
  log_mermas_mes: 'Logística › Mermas: reclasifica el movimiento a mano o ajusta la regla por texto de la nota. El cambio se refleja en el asiento del mes mientras el período esté abierto.',
  libro_ventas_dia: 'Documentos emitidos en BSALE (libro de ventas SII). Una corrección se hace con nota de crédito en BSALE.',
  costo_ventas_mes: 'Reporte de márgenes de BSALE cargado en Libros y estados › Ventas contra BSALE.',
  rrhh_liquidaciones_mes: 'RRHH › Remuneraciones (liquidaciones cargadas desde Contaline).',
  rem_socios_mes: 'Contabilidad › Registro › Pagos a socios.',
  comisiones_mes: 'Tesorería › Depósitos y abonos (abonos Getnet) y facturas de Getnet en Compras.',
}
const fmtO = v => typeof v === 'number' ? fmt(v) : (v == null ? '' : String(v))
export function OrigenAsiento({ numero, cuenta, onClose }) {
  const [o, setO] = useState(null)
  useEffect(() => {
    let vivo = true
    supabase.rpc('fn_origen_asiento', { p_numero: numero, p_cuenta: cuenta ?? null })
      .then(({ data, error }) => { if (vivo) setO(error ? { error: error.message } : data) })
    return () => { vivo = false }
  }, [numero, cuenta])
  const cols = o?.columnas ?? []
  const filas = o?.filas ?? []
  const esNum = i => filas.some(f => typeof f[i] === 'number')
  const iMonto = cols.findIndex(c => /^(costo|monto|total|neto|venta neta)$/i.test(c))
  const total = iMonto >= 0 ? filas.reduce((s, f) => s + Number(f[iMonto] || 0), 0) : null
  const exportar = () => exportarExcel(filas.map(f => Object.fromEntries(cols.map((c, i) => [c, f[i]]))), `origen_asiento_${numero}`, 'Origen')
  return (
    <div role="dialog" aria-label={`Origen del asiento ${numero}`} style={{ position: 'fixed', inset: 0, background: 'rgba(15,24,48,0.25)', zIndex: 80 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(1040px, 96vw)', background: '#fff', boxShadow: '-10px 0 40px rgba(0,0,0,0.22)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDE}`, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{o?.titulo ?? 'Origen del asiento'}</div>
            {o?.asiento && (
              <div style={{ fontSize: 11.5, color: SLATE, marginTop: 2 }}>
                {o.asiento.comprobante ? `Comprobante ${o.asiento.comprobante} · ` : ''}Asiento {o.asiento.numero} del {o.asiento.fecha} · generado por {o.asiento.creado_por}
                <div style={{ color: '#1C1C1E', marginTop: 2 }}>{o.asiento.glosa}</div>
              </div>
            )}
          </div>
          <button onClick={exportar} disabled={!filas.length} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>
          <button onClick={onClose} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: 'none', background: NAVY, color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cerrar</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '10px 16px' }}>
          {!o ? <div style={{ padding: 28, textAlign: 'center', color: SLATE, fontSize: 12 }}>Buscando el origen…</div>
            : o.error ? <div style={{ padding: 20, color: '#B42318', fontSize: 12.5 }}>No se pudo obtener el origen: {o.error}</div>
            : (<>
              {o.explicacion && <div style={{ fontSize: 12, color: '#1C1C1E', background: '#F9FAFB', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>{o.explicacion}</div>}
              {DONDE_CORREGIR[o.asiento?.origen] && <div style={{ fontSize: 12, color: NAVY, marginBottom: 10 }}><b>Dónde se corrige:</b> {DONDE_CORREGIR[o.asiento.origen]}</div>}
              <div style={{ fontSize: 11.5, color: SLATE, marginBottom: 4 }}>{filas.length} registro{filas.length === 1 ? '' : 's'}{total != null ? <> · total <b style={{ color: NAVY }}>{fmt(total)}</b></> : null}</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{cols.map((c, i) => <th key={c} style={{ textAlign: esNum(i) ? 'right' : 'left', fontSize: 10, color: SLATE, padding: '6px 8px', borderBottom: `1px solid ${NAVY}`, position: 'sticky', top: 0, background: '#fff', whiteSpace: 'nowrap' }}>{c}</th>)}</tr></thead>
                  <tbody>{filas.map((f, r) => (
                    <tr key={r}>{cols.map((c, i) => <td key={c} style={{ fontSize: 11.5, padding: '5px 8px', borderBottom: '1px solid #F3F4F6', textAlign: esNum(i) ? 'right' : 'left', fontFamily: esNum(i) ? 'ui-monospace, monospace' : undefined, whiteSpace: String(f[i] ?? '').length <= 12 ? 'nowrap' : 'normal', maxWidth: 320 }}>{fmtO(f[i])}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
              {(o.lineas ?? []).length > 0 && (<>
                <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, margin: '16px 0 4px' }}>Líneas del asiento</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>{['Cuenta', 'Nombre', 'Debe', 'Haber', 'Glosa', 'Tercero'].map((c, i) => <th key={c} style={{ textAlign: i === 2 || i === 3 ? 'right' : 'left', fontSize: 10, color: SLATE, padding: '5px 8px', borderBottom: `1px solid ${BORDE}` }}>{c}</th>)}</tr></thead>
                  <tbody>{o.lineas.map((l, r) => (
                    <tr key={r} style={{ background: cuenta && l[0] === cuenta ? '#EEF1F7' : undefined }}>{l.map((v, i) => <td key={i} style={{ fontSize: 11.5, padding: '4px 8px', borderBottom: '1px solid #F3F4F6', textAlign: i === 2 || i === 3 ? 'right' : 'left', fontFamily: i === 2 || i === 3 ? 'ui-monospace, monospace' : undefined }}>{i === 2 || i === 3 ? (Number(v) ? fmt(v) : '') : fmtO(v)}</td>)}</tr>
                  ))}</tbody>
                </table>
              </>)}
            </>)}
        </div>
      </div>
    </div>
  )
}

export async function abrirFuente(setDet, { titulo, sub, query, limite = 3000 }) {
  setDet({ titulo, sub, filas: [], cargando: true })
  const { data, error } = await query.limit(limite)
  setDet({ titulo, sub: error ? `Error: ${error.message}` : sub, filas: data ?? [], cargando: false })
}

export function FuenteDrawer({ det, onClose }) {
  const [origen, setOrigen] = useState(null)
  if (!det) return null
  const filas = det.filas ?? []
  const cols = filas.length ? Object.keys(filas[0]).filter(k => !/^id$|_id$|^created_at$/.test(k)).slice(0, 9) : []
  const colMonto = cols.find(k => /^(monto|total|debe|haber|saldo|neto)/.test(k))
  const total = colMonto ? filas.reduce((s, f) => s + Number(f[colMonto] || 0), 0) : null
  const esNum = k => filas.some(f => typeof f[k] === 'number')
  const archivo = det.titulo.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60)

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(760px, 94vw)', background: '#fff', boxShadow: '-8px 0 30px rgba(0,0,0,0.18)', zIndex: 60, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${BORDE}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{det.titulo}</div>
          <div style={{ fontSize: 11, color: SLATE }}>
            Fuente del dato · {filas.length} registros{total != null ? <> · total <b style={{ color: NAVY }}>{fmt(total)}</b></> : null}
            {det.sub ? <> · {det.sub}</> : null}
          </div>
        </div>
        <button onClick={() => exportarExcel(filas, archivo, 'Fuente')} disabled={!filas.length}
          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', cursor: 'pointer', fontWeight: 600, color: NAVY }}>Excel</button>
        <button onClick={() => exportarPDF({ titulo: det.titulo, sub: det.sub, filas, archivo })} disabled={!filas.length}
          style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', cursor: 'pointer', fontWeight: 600, color: NAVY }}>PDF</button>
        <button onClick={onClose} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: 'none', background: NAVY, color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cerrar</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {det.cargando ? <div style={{ padding: 28, textAlign: 'center', color: SLATE, fontSize: 12 }}>Cargando fuente…</div>
          : !filas.length ? <div style={{ padding: 28, textAlign: 'center', color: SLATE, fontSize: 12 }}>Sin registros</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{cols.map(k => (
                <th key={k} style={{ textAlign: esNum(k) ? 'right' : 'left', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.4, color: SLATE, padding: '6px 10px', borderBottom: `1px solid ${NAVY}`, position: 'sticky', top: 0, background: '#fff', whiteSpace: 'nowrap' }}>
                  {k.replace(/_/g, ' ')}
                </th>))}</tr></thead>
              <tbody>
                {filas.slice(0, 800).map((f, i) => (
                  <tr key={i} onClick={f.asiento ? () => setOrigen({ numero: f.asiento, cuenta: f.cuenta ?? f.plan_cuenta_codigo }) : undefined}
                    style={{ cursor: f.asiento ? 'pointer' : undefined }} title={f.asiento ? 'Ver el origen de este asiento' : undefined}>
                    {cols.map(k => (
                      <td key={k} style={{ fontSize: 11.5, padding: '5px 10px', borderBottom: '1px solid #F3F4F6', textAlign: esNum(k) ? 'right' : 'left', fontFamily: esNum(k) ? 'ui-monospace, monospace' : undefined, whiteSpace: 'normal', maxWidth: 240, color: '#1C1C1E' }}>
                        {f[k] == null ? '' : typeof f[k] === 'number' ? fmt(f[k]) : typeof f[k] === 'boolean' ? (f[k] ? 'sí' : 'no') : String(f[k]).slice(0, 140)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        {filas.length > 800 && <div style={{ padding: 10, fontSize: 11, color: SLATE, textAlign: 'center' }}>Mostrando 800 de {filas.length} — el export incluye todo</div>}
      </div>
      {origen && <OrigenAsiento numero={origen.numero} cuenta={origen.cuenta} onClose={() => setOrigen(null)} />}
    </div>
  )
}
