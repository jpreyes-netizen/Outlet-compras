/* ════════════════════════════════════════════════════════════════════
   invPdfProducto.js — informe PDF por producto (una página por ítem)
   1. Cómo se compone su venta promedio (frase con las cifras reales)
   2. Composición por bodega: método, ventana, unidades, días con stock
   3. Gráfico: 12 meses + mes en curso + 3 meses proyectados, con la línea
      de venta promedio actual (vectorial, dibujado con jsPDF)
   4. Meses usados: unidades y % de días con stock
   5. Proyección del stock disponible y fecha estimada de quiebre
   ════════════════════════════════════════════════════════════════════ */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { METODOS, METODOLOGIA, DIAS_MES, composicion, explicar, contrasteHistorico, armarSerie, proyectarMeses, proyeccionStock,
         agregarRed, nombreMes, fechaCorta, SALAS_IDS, ventaDelAnio, ultimos13 } from './invProyeccion'

const NAVY = [22, 33, 62], GRIS = [110, 110, 115], TINTA = [28, 28, 30], VERDE = [30, 122, 68], AMBAR = [178, 94, 9], ROJO = [180, 35, 24]
const n0 = v => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(+v || 0))
const n2 = v => new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(+v || 0)
const NOMBRES = { 'suc-lg': 'La Granja', 'suc-la': 'Los Ángeles', 'suc-maipu': 'Tienda Maipú', 'suc-mp': 'CD Maipú' }

function encabezado(doc, titulo, sub) {
  const W = doc.internal.pageSize.getWidth()
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 20, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont(undefined, 'bold'); doc.setFontSize(12); doc.text('OUTLET DE PUERTAS SpA', 14, 8.5)
  doc.setFont(undefined, 'normal'); doc.setFontSize(9.5); doc.text(titulo, 14, 15)
  doc.setFontSize(7.5); doc.text(`Emitido ${new Date().toLocaleString('es-CL')}`, W - 14, 8.5, { align: 'right' })
  if (sub) doc.text(String(sub).slice(0, 95), W - 14, 15, { align: 'right' })
}

function subtitulo(doc, txt, y) {
  doc.setTextColor(...NAVY); doc.setFont(undefined, 'bold'); doc.setFontSize(10); doc.text(txt, 14, y)
  doc.setFont(undefined, 'normal')
  return y + 2
}

function parrafo(doc, txt, y, tam = 8.3, color = TINTA) {
  const W = doc.internal.pageSize.getWidth()
  doc.setFontSize(tam); doc.setTextColor(...color)
  const lineas = doc.splitTextToSize(txt, W - 28)
  doc.text(lineas, 14, y)
  return y + lineas.length * tam * 0.42 + 1.5
}

/* Gráfico de barras vectorial: historia + proyección + línea de venta promedio */
function graficoVenta(doc, serie, proy, diaria, x0, y0, w, h) {
  const datos = [...serie, ...proy]
  const prom = diaria * DIAS_MES
  const max = Math.max(...datos.map(d => d.unidades), prom, 1) * 1.12
  const iw = w / datos.length
  const y = v => y0 + h * (1 - v / max)
  doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.2)
  for (const t of [...new Set([0, max / 2, max].map(v => Math.round(v)))]) {
    doc.line(x0, y(t), x0 + w, y(t))
    doc.setFontSize(6.5); doc.setTextColor(...GRIS); doc.text(n0(t), x0 - 1.5, y(t) + 1, { align: 'right' })
  }
  datos.forEach((d, i) => {
    const bx = x0 + iw * i + iw * 0.15, bw = iw * 0.7, bh = Math.max(y0 + h - y(d.unidades), 0)
    if (d.proyectado) {
      doc.setDrawColor(...VERDE); doc.setLineWidth(0.35); doc.setLineDashPattern([1.2, 0.8], 0)
      doc.rect(bx, y0 + h - bh, bw, bh, 'S'); doc.setLineDashPattern([], 0)
    } else {
      doc.setFillColor(...(d.parcial ? [138, 145, 165] : NAVY)); doc.rect(bx, y0 + h - bh, bw, bh, 'F')
    }
    if (d.pctStock != null && d.pctStock < 80) { doc.setFillColor(...AMBAR); doc.circle(bx + bw / 2, y0 + h - bh - 2, 0.9, 'F') }
    doc.setFontSize(6.3); doc.setTextColor(...(d.proyectado ? VERDE : TINTA))
    doc.text(nombreMes(d.mes), bx + bw / 2, y0 + h + 3.5, { align: 'center' })
  })
  doc.setDrawColor(...VERDE); doc.setLineWidth(0.45); doc.setLineDashPattern([1.6, 1.1], 0)
  doc.line(x0, y(prom), x0 + w, y(prom)); doc.setLineDashPattern([], 0)
  doc.setFontSize(7); doc.setTextColor(...VERDE); doc.setFont(undefined, 'bold')
  doc.text(`venta promedio actual: ${n2(prom)} al mes`, x0 + w, y(prom) - 1.3, { align: 'right' }); doc.setFont(undefined, 'normal')
  // leyenda
  const ly = y0 + h + 8.5
  doc.setFontSize(6.6); doc.setTextColor(...GRIS)
  doc.setFillColor(...NAVY); doc.rect(x0, ly - 2.2, 3, 2.4, 'F'); doc.text('venta del mes', x0 + 4, ly)
  doc.setFillColor(138, 145, 165); doc.rect(x0 + 24, ly - 2.2, 3, 2.4, 'F'); doc.text('mes en curso', x0 + 28, ly)
  doc.setDrawColor(...VERDE); doc.setLineDashPattern([1, 0.7], 0); doc.rect(x0 + 47, ly - 2.2, 3, 2.4, 'S'); doc.setLineDashPattern([], 0); doc.text('proyección a la venta promedio', x0 + 51, ly)
  doc.setFillColor(...AMBAR); doc.circle(x0 + 93, ly - 1, 0.9, 'F'); doc.text('mes con stock menos del 80% de los días', x0 + 95, ly)
  return ly + 3
}

/* Línea de stock proyectado */
function graficoStock(doc, p, x0, y0, w, h) {
  const max = Math.max(p.disponible, p.puntoReorden, p.seguridad, 1) * 1.1
  const x = d => x0 + w * d / p.horizonte, y = v => y0 + h * (1 - v / max)
  doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.2); doc.line(x0, y0 + h, x0 + w, y0 + h)
  for (const d of [0, 30, 60, 90]) { doc.setFontSize(6.3); doc.setTextColor(...GRIS); doc.text(d ? `+${d} d` : 'hoy', x(d), y0 + h + 3.4, { align: 'center' }) }
  doc.text(n0(max / 1.1), x0 - 1.5, y(max / 1.1) + 1, { align: 'right' })
  const linea = (v, color, txt, abajo) => {
    if (!(v > 0)) return
    doc.setDrawColor(...color); doc.setLineWidth(0.3); doc.setLineDashPattern([1.2, 1], 0); doc.line(x0, y(v), x0 + w, y(v)); doc.setLineDashPattern([], 0)
    doc.setFontSize(6.5); doc.setTextColor(...color); doc.text(`${txt} ${n0(v)}`, x0 + w, y(v) + (abajo ? 3 : -1), { align: 'right' })
  }
  linea(p.puntoReorden, AMBAR, 'punto de reorden'); linea(p.seguridad, ROJO, 'stock de seguridad', true)
  doc.setDrawColor(...NAVY); doc.setLineWidth(0.6)
  for (let i = 1; i < p.puntos.length; i++) doc.line(x(p.puntos[i - 1].dia), y(p.puntos[i - 1].stock), x(p.puntos[i].dia), y(p.puntos[i].stock))
  if (p.diasQuiebre != null && p.diasQuiebre <= p.horizonte) {
    doc.setDrawColor(...ROJO); doc.setLineWidth(0.4); doc.line(x(p.diasQuiebre), y0, x(p.diasQuiebre), y0 + h)
    doc.setFontSize(7); doc.setTextColor(...ROJO); doc.setFont(undefined, 'bold')
    doc.text(`se acaba aprox. ${fechaCorta(p.fechaQuiebre)}`, x(p.diasQuiebre) + (p.diasQuiebre > 65 ? -1.5 : 1.5), y0 + 3, { align: p.diasQuiebre > 65 ? 'right' : 'left' })
    doc.setFont(undefined, 'normal')
  }
  return y0 + h + 6
}

/* Página de metodología (va al inicio del PDF) */
function paginaMetodologia(doc, titulo, sub) {
  encabezado(doc, titulo, sub)
  let y = subtitulo(doc, 'Cómo se calcula la venta promedio', 30) + 3
  for (const p of METODOLOGIA) y = parrafo(doc, '• ' + p, y, 8.6) + 0.6
  y = subtitulo(doc, 'Métodos posibles', y + 4) + 1
  autoTable(doc, {
    startY: y, head: [['Método', 'Cuándo se usa']],
    body: Object.values(METODOS).map(m => [m.l, m.d]),
    styles: { fontSize: 7.8, cellPadding: 1.8, textColor: TINTA }, headStyles: { fillColor: [243, 244, 246], textColor: NAVY, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 62, fontStyle: 'bold' } },
  })
}

/* items: [{ sku, filas (base: todas las bodegas del SKU), serie (fn_inv_serie_mensual), ambito: 'red' | sucursal_id }] */
export function pdfProductos({ items, titulo = 'Venta promedio y proyección por producto', sub, archivo = 'proyeccion_productos' }) {
  if (!items?.length) return
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  paginaMetodologia(doc, titulo, sub)

  for (const it of items) {
    doc.addPage(); encabezado(doc, titulo, sub)
    const f0 = it.filas[0] || {}
    const salas = it.filas.filter(r => r.vende)
    const esRed = it.ambito === 'red'
    const fila = esRed ? null : it.filas.find(r => r.sucursal_id === it.ambito)
    const ambNombre = esRed ? 'Red (suma de las salas)' : NOMBRES[it.ambito] || it.ambito
    const diaria = esRed ? salas.reduce((a, r) => a + (+r.demanda_dia || 0), 0) : +fila?.demanda_dia || 0

    doc.setTextColor(...TINTA); doc.setFont(undefined, 'bold'); doc.setFontSize(12)
    doc.text(doc.splitTextToSize(String(f0.producto || it.sku), W - 28)[0], 14, 29)
    doc.setFont(undefined, 'normal'); doc.setFontSize(8.3); doc.setTextColor(...GRIS)
    doc.text(`${it.sku} · Categoría: ${f0.tipo_producto || '—'} · Familia: ${f0.familia || '—'} · Clase ${f0.clase || '—'} · Ámbito: ${ambNombre}`, 14, 34)

    let y = subtitulo(doc, 'Cómo se compone la venta promedio', 42) + 3
    if (esRed) {
      y = parrafo(doc, `La venta promedio de la red es la suma de la de cada sala: ${salas.map(r => `${NOMBRES[r.sucursal_id]} ${n2(r.demanda_dia)}`).join(' + ')} = ${n2(diaria)} unidades por día (aprox. ${n2(diaria * DIAS_MES)} al mes).`, y)
    } else {
      y = parrafo(doc, explicar(composicion(fila), n2), y)
    }

    autoTable(doc, {
      startY: y + 1,
      head: [['Bodega', 'Método', 'Ventana (días completos)', 'Unidades', 'Días con stock', 'Prom. diaria', 'Prom. mensual', 'Sin corregir*']],
      body: salas.map(r => {
        const c = composicion(r)
        return c ? [NOMBRES[r.sucursal_id], METODOS[c.metodo].corto, `${fechaCorta(c.desde)} al ${fechaCorta(c.hasta)}`, n0(c.unidades),
                    c.metodo === 'calendario_84' ? '— (calendario)' : `${c.dias} de ${c.observados}`, n2(c.diaria), n2(c.mensual), n2(c.calendario)]
                 : [NOMBRES[r.sucursal_id], '—', '—', '—', '—', '—', '—', '—']
      }),
      styles: { fontSize: 7.5, cellPadding: 1.5, textColor: TINTA }, headStyles: { fillColor: [243, 244, 246], textColor: NAVY, fontStyle: 'bold', fontSize: 7.2 },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' }, 6: { halign: 'right' }, 7: { halign: 'right', textColor: GRIS } },
    })
    y = parrafo(doc, '* Sin corregir: la misma venta dividida por todos los días de la ventana, incluidos los días sin stock. La diferencia es la demanda que el quiebre esconde.',
                doc.lastAutoTable.finalY + 4, 6.8, GRIS)

    const serieLarga = armarSerie(it.serie, esRed ? SALAS_IDS : [it.ambito])
    const serie = ultimos13(serieLarga)
    const proy = proyectarMeses(diaria, 3)
    const va = ventaDelAnio(serieLarga)
    y = subtitulo(doc, `Venta ${va.anio} contra ${va.anio - 1} (unidades)`, y + 3) + 2
    autoTable(doc, {
      startY: y,
      head: [['Año', ...va.meses.map(x => x.nombre + (x.enCurso ? '*' : '')), 'Acumulado']],
      body: [[String(va.anio), ...va.meses.map(x => x.futuro ? '' : n0(x.actual)), n0(va.ytd)],
             [String(va.anio - 1), ...va.meses.map(x => n0(x.anterior)), n0(va.ytdAnt)]],
      styles: { fontSize: 6.6, cellPadding: 1, halign: 'right', textColor: TINTA }, headStyles: { fillColor: [243, 244, 246], textColor: NAVY, fontStyle: 'bold', halign: 'right' },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold' }, 13: { fontStyle: 'bold' } },
    })
    y = parrafo(doc, (va.variacion == null ? `Sin venta en el mismo período de ${va.anio - 1}.` :
      `Acumulado ${va.anio}: ${n0(va.ytd)} unidades, ${va.variacion >= 0 ? '+' : ''}${n2(va.variacion)}% contra el mismo período de ${va.anio - 1} (${n0(va.ytdAnt)}).`) +
      ' * mes en curso, hasta ayer: no entra al acumulado.', doc.lastAutoTable.finalY + 3.5, 7, GRIS)
    const contraste = contrasteHistorico(serie, diaria)
    if (contraste) y = parrafo(doc, 'ATENCIÓN · ' + contraste.texto, y + 2, 7.8, AMBAR)
    y = subtitulo(doc, 'Venta mensual de los últimos 12 meses y proyección a 3 meses', y + 3) + 4
    y = graficoVenta(doc, serie, proy, diaria, 24, y, W - 38, 52) + 2

    autoTable(doc, {
      startY: y,
      head: [['', ...serie.map(s => nombreMes(s.mes) + (s.parcial ? '*' : '')), ...proy.map(p => nombreMes(p.mes))]],
      body: [
        ['Unidades', ...serie.map(s => n0(s.unidades)), ...proy.map(p => n0(p.unidades))],
        ['% días con stock', ...serie.map(s => s.pctStock == null ? 's/r' : s.pctStock + '%'), ...proy.map(() => 'proy.')],
      ],
      styles: { fontSize: 6.4, cellPadding: 1, halign: 'right', textColor: TINTA }, headStyles: { fillColor: [243, 244, 246], textColor: NAVY, fontStyle: 'bold', halign: 'right' },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: 24 } },
      didParseCell: d => { if (d.column.index > serie.length) d.cell.styles.textColor = VERDE },
    })
    y = parrafo(doc, '* mes en curso, hasta ayer. s/r: sin registro diario de inventario ese mes (el inventario diario existe desde junio 2026; antes sólo hay cierres de mes). Las proyecciones son la venta promedio actual por los días de cada mes; no incluyen estacionalidad.',
                doc.lastAutoTable.finalY + 3.5, 6.6, GRIS)

    const base = esRed ? agregarRed(it.filas) : fila
    const p = proyeccionStock({ disponible: base?.disponible, diaria, puntoReorden: base?.punto_reorden, seguridad: base?.safety_stock })
    y = subtitulo(doc, 'Proyección del stock disponible (sin compras nuevas)', y + 3) + 3
    const sinStock = !(p.disponible > 0)
    y = parrafo(doc, sinStock
      ? `No hay stock disponible hoy en ${esRed ? 'las salas' : ambNombre}: está en quiebre.` +
        (+base?.transito > 0 ? ` Hay ${n0(base.transito)} unidades en tránsito.` : '') +
        (diaria > 0 ? ` A la venta promedio actual se dejan de vender cerca de ${n0(diaria * 7)} unidades por semana.` : '')
      : diaria > 0
      ? `Stock disponible hoy: ${n0(p.disponible)} unidades. A ${n2(diaria)} por día, ${p.diasQuiebre > 365 ? 'alcanza para más de un año' : `se acaba aproximadamente el ${fechaCorta(p.fechaQuiebre)} (${n0(p.diasQuiebre)} días)`}` +
        (p.puntoReorden > 0 ? `; llega al punto de reorden (${n0(p.puntoReorden)}) ${p.diasReorden === 0 ? 'ya' : `el ${fechaCorta(p.fechaReorden)}`}.` : '.') +
        (+base?.transito > 0 ? ` Hay ${n0(base.transito)} unidades en tránsito, no incluidas por no tener fecha de llegada.` : '')
      : 'Sin venta promedio: el stock no baja por venta.', y)
    if (!sinStock && diaria > 0 && y < H - 40) graficoStock(doc, p, 24, y + 1, W - 38, Math.min(32, H - y - 18))
  }

  const n = doc.internal.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(7); doc.setTextColor(...GRIS)
    doc.text(`Página ${i} de ${n}`, W - 14, H - 6, { align: 'right' }); doc.text('ERP Outlet de Puertas — Análisis de stock', 14, H - 6)
  }
  doc.save(`${archivo}_${new Date().toISOString().slice(0, 10)}.pdf`)
}
