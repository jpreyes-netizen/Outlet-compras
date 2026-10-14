/* ════════════════════════════════════════════════════════════════════
   invReportes.js — Excel y PDF de Inventario
   · Tablas simples: el exportador corporativo de Finanzas (mismo formato
     en todo el ERP).
   · Informe completo: varias secciones en un PDF y varias hojas en un
     Excel, con el mismo encabezado navy, fecha de emisión y paginado.
   ════════════════════════════════════════════════════════════════════ */

import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { exportarExcel, exportarPDF } from '../finanzas/exportUtils'

const hoy = () => new Date().toISOString().slice(0, 10)
const fmtCL = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n) || 0))

/* Convierte filas + columnas de pantalla ({k, l, num?, crudo?}) en filas planas con encabezados legibles */
export function aPlano(filas, cols) {
  return (filas || []).map(f => Object.fromEntries(cols.map(c => [c.l, c.crudo ? c.crudo(f) : f[c.k]])))
}

export function tablaExcel(filas, cols, nombre) {
  if (!filas?.length) return
  exportarExcel(aPlano(filas, cols), `${nombre}_${hoy()}`, nombre)
}

export function tablaPdf({ titulo, sub, filas, cols, nombre, orientacion }) {
  if (!filas?.length) return
  exportarPDF({
    titulo, sub, archivo: `${nombre}_${hoy()}`, orientacion,
    filas: filas.map(f => Object.fromEntries(cols.map(c => [c.k, c.crudo ? c.crudo(f) : f[c.k]]))),
    columnas: cols.map(c => ({ k: c.k, l: c.l, num: !!c.num })),
  })
}

/* ── Informe completo ─────────────────────────────────────────────────
   secciones: [{ titulo, nota?, cols: [{k,l,num?,crudo?}], filas }]     */
export function informePdf({ titulo, sub, secciones, archivo }) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  const encabezado = () => {
    doc.setFillColor(22, 33, 62); doc.rect(0, 0, W, 22, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(13); doc.setFont(undefined, 'bold'); doc.text('OUTLET DE PUERTAS SpA', 14, 9)
    doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.text(titulo, 14, 16)
    doc.setFontSize(8); doc.text(`Emitido ${new Date().toLocaleString('es-CL')}`, W - 14, 9, { align: 'right' })
    if (sub) doc.text(String(sub).slice(0, 120), W - 14, 16, { align: 'right' })
  }
  encabezado()
  let y = 28
  for (const s of secciones.filter(s => s.filas?.length)) {
    if (y > H - 40) { doc.addPage(); encabezado(); y = 28 }
    doc.setTextColor(22, 33, 62); doc.setFontSize(11); doc.setFont(undefined, 'bold')
    doc.text(s.titulo, 14, y); y += 2
    if (s.nota) {
      doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(110, 110, 115)
      const lineas = doc.splitTextToSize(s.nota, W - 28)
      doc.text(lineas, 14, y + 4); y += 3 + lineas.length * 3.4
    }
    autoTable(doc, {
      startY: y + 2,
      head: [s.cols.map(c => c.l)],
      body: s.filas.map(f => s.cols.map(c => {
        const v = c.crudo ? c.crudo(f) : f[c.k]
        if (v == null || v === '') return ''
        return c.num && !isNaN(Number(v)) ? fmtCL(v) : String(v).slice(0, 80)
      })),
      styles: { fontSize: 7.5, cellPadding: 1.6, textColor: [28, 28, 30] },
      headStyles: { fillColor: [243, 244, 246], textColor: [22, 33, 62], fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: Object.fromEntries(s.cols.map((c, i) => [i, c.num ? { halign: 'right', font: 'courier' } : {}])),
      alternateRowStyles: { fillColor: [250, 250, 251] },
      margin: { top: 28 },
      didDrawPage: d => { if (d.pageNumber > 1 && d.cursor?.y < 30) encabezado() },
    })
    y = doc.lastAutoTable.finalY + 9
  }
  const n = doc.internal.getNumberOfPages()
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFontSize(7.5); doc.setTextColor(110, 110, 115)
    doc.text(`Página ${p} de ${n}`, W - 14, H - 6, { align: 'right' })
    doc.text('ERP Outlet de Puertas — Análisis de stock', 14, H - 6)
  }
  doc.save(`${archivo}_${hoy()}.pdf`)
}

export function informeExcel({ secciones, archivo }) {
  const wb = XLSX.utils.book_new()
  const usadas = new Set()
  for (const s of secciones.filter(s => s.filas?.length)) {
    let nombre = s.hoja || s.titulo
    nombre = nombre.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
    while (usadas.has(nombre)) nombre = nombre.slice(0, 28) + ' ' + usadas.size
    usadas.add(nombre)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(aPlano(s.filas, s.cols)), nombre)
  }
  XLSX.writeFile(wb, `${archivo}_${hoy()}.xlsx`)
}
