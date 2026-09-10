/* ══════════════════════════════════════════════════════════════════════
   VOUCHER CONTABLE — impresión formal de un asiento
   Genera el comprobante en una ventana nueva lista para imprimir/guardar PDF.
   Formato estándar: encabezado empresa, N° y fecha, glosa, detalle debe/haber
   con cuenta y tercero, totales, origen/trazabilidad, firmas.
   ══════════════════════════════════════════════════════════════════════ */
const fmt = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n || 0)))
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const ORIGEN = {
  compra: 'Factura de compra', venta: 'Ventas del día', banco: 'Movimiento bancario', remuneracion: 'Remuneraciones',
  ajuste: 'Ajuste automático', cierre: 'Cierre / provisión', manual: 'Comprobante manual', apertura: 'Asiento de apertura',
}

/**
 * @param {object} a  asiento: { numero, fecha, periodo, glosa, origen, origen_tabla, origen_id, estado, total_debe, total_haber, created_by, contabilizado_at }
 * @param {array}  lineas [{ orden, plan_cuenta_codigo, cuenta (nombre), glosa, tercero_nombre, debe, haber }]
 */
export function imprimirComprobante(a, lineas) {
  const totalD = lineas.reduce((s, l) => s + Number(l.debe || 0), 0)
  const totalH = lineas.reduce((s, l) => s + Number(l.haber || 0), 0)
  const anulado = a.estado === 'anulado' || a.anulado_por_asiento_id
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Comprobante contable N° ${esc(a.numero)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: -apple-system, 'SF Pro Display', system-ui, sans-serif; color: #1C1C1E; margin: 0; font-size: 12px; }
  .cab { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #16213E; padding-bottom: 10px; }
  .emp { font-size: 16px; font-weight: 700; color: #16213E; letter-spacing: 0.5px; }
  .sub { font-size: 10.5px; color: #6E6E73; margin-top: 2px; }
  .titulo { text-align: right; }
  .titulo .t { font-size: 14px; font-weight: 700; color: #16213E; text-transform: uppercase; letter-spacing: 0.8px; }
  .titulo .n { font-size: 22px; font-weight: 700; font-family: ui-monospace, monospace; margin-top: 2px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px 18px; margin: 14px 0; }
  .meta div { font-size: 11.5px; } .meta b { display: block; font-size: 9.5px; color: #6E6E73; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 1px; }
  .glosa { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 4px; padding: 8px 10px; font-size: 12px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.5px; color: #6E6E73; padding: 6px 8px; border-bottom: 1px solid #16213E; }
  th.num, td.num { text-align: right; font-family: ui-monospace, monospace; white-space: nowrap; }
  td { padding: 6px 8px; border-bottom: 1px solid #F3F4F6; vertical-align: top; }
  td.cod { font-family: ui-monospace, monospace; color: #6E6E73; white-space: nowrap; }
  tr.tot td { border-top: 2px solid #16213E; border-bottom: none; font-weight: 700; padding-top: 8px; }
  .cuadra { text-align: right; font-size: 11px; margin-top: 4px; color: ${Math.round(totalD) === Math.round(totalH) ? '#1E7A44' : '#B42318'}; font-weight: 600; }
  .firmas { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-top: 46px; }
  .firma { border-top: 1px solid #1C1C1E; padding-top: 6px; font-size: 10.5px; color: #6E6E73; text-align: center; }
  .pie { margin-top: 22px; font-size: 9.5px; color: #9CA3AF; display: flex; justify-content: space-between; }
  .anulado { position: fixed; top: 38%; left: 10%; right: 10%; text-align: center; font-size: 64px; font-weight: 800; color: rgba(180,35,24,0.13); transform: rotate(-18deg); pointer-events: none; }
  @media print { .noprint { display: none; } }
</style></head><body>
${anulado ? '<div class="anulado">ANULADO</div>' : ''}
<div class="cab">
  <div><div class="emp">OUTLET DE PUERTAS SpA</div><div class="sub">Contabilidad · Libro diario</div></div>
  <div class="titulo"><div class="t">Comprobante contable</div><div class="n">N° ${esc(a.numero)}</div></div>
</div>
<div class="meta">
  <div><b>Fecha</b>${esc(a.fecha)}</div>
  <div><b>Período</b>${esc(a.periodo || String(a.fecha).slice(0, 7))}</div>
  <div><b>Estado</b>${esc(anulado ? 'Anulado' : a.estado)}</div>
  <div><b>Origen</b>${esc(ORIGEN[a.origen] || a.origen)}</div>
  <div><b>Documento origen</b>${esc(a.origen_tabla || '—')}${a.origen_id ? ' · ' + esc(String(a.origen_id).slice(0, 36)) : ''}</div>
  <div><b>Registrado por</b>${esc(a.created_by || '—')}${a.contabilizado_at ? ' · ' + esc(String(a.contabilizado_at).slice(0, 16).replace('T', ' ')) : ''}</div>
</div>
<div class="glosa">${esc(a.glosa)}</div>
<table>
  <thead><tr><th style="width:90px">Cuenta</th><th>Nombre</th><th>Detalle / tercero</th><th class="num" style="width:120px">Debe</th><th class="num" style="width:120px">Haber</th></tr></thead>
  <tbody>
    ${lineas.map(l => `<tr>
      <td class="cod">${esc(l.plan_cuenta_codigo)}</td>
      <td>${esc(l.cuenta || l.cuenta_nombre || '')}</td>
      <td style="color:#6E6E73">${esc([l.glosa, l.tercero_nombre].filter(Boolean).join(' · '))}</td>
      <td class="num">${Number(l.debe) > 0 ? fmt(l.debe) : ''}</td>
      <td class="num">${Number(l.haber) > 0 ? fmt(l.haber) : ''}</td></tr>`).join('')}
    <tr class="tot"><td colspan="3">Totales</td><td class="num">${fmt(totalD)}</td><td class="num">${fmt(totalH)}</td></tr>
  </tbody>
</table>
<div class="cuadra">${Math.round(totalD) === Math.round(totalH) ? 'Partida doble cuadrada' : 'ATENCIÓN: debe ≠ haber'}</div>
<div class="firmas"><div class="firma">Preparado</div><div class="firma">Revisado</div><div class="firma">Aprobado</div></div>
<div class="pie"><span>Emitido ${new Date().toLocaleString('es-CL')}</span><span>ERP Outlet de Puertas · comprobante generado desde el libro diario</span></div>
<div class="noprint" style="margin-top:18px;text-align:center"><button onclick="window.print()" style="padding:8px 18px;font-size:13px;cursor:pointer">Imprimir / Guardar PDF</button></div>
</body></html>`
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) { alert('El navegador bloqueó la ventana del comprobante. Permití ventanas emergentes para este sitio.'); return }
  w.document.open(); w.document.write(html); w.document.close()
  w.focus()
  setTimeout(() => { try { w.print() } catch (e) { /* el usuario puede imprimir desde el botón */ } }, 400)
}
