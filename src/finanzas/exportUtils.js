/* ══════════════════════════════════════════════════════════════════════
   EXPORTADOR CORPORATIVO — Excel y PDF para cualquier informe
   exportarExcel(filas, archivo, hoja)
   exportarPDF({ titulo, sub, filas, columnas?, archivo?, orientacion? })
   Columnas: se derivan automáticamente de las filas si no se entregan.
   Formato PDF: encabezado navy corporativo, fecha de emisión, paginado.
   ══════════════════════════════════════════════════════════════════════ */
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const fmtCL = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n)))

export function exportarExcel(filas, archivo = 'informe', hoja = 'Datos') {
  if (!filas?.length) return
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), hoja.slice(0, 31))
  XLSX.writeFile(wb, `${archivo}.xlsx`)
}

function prepararColumnas(filas, columnas) {
  if (columnas?.length) return columnas
  const keys = Object.keys(filas[0] ?? {})
  return keys.map(k => ({
    k,
    l: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    num: filas.some(f => typeof f[k] === 'number' || (f[k] != null && f[k] !== '' && !isNaN(Number(f[k])) && String(f[k]).length < 16 && /^[\d.-]+$/.test(String(f[k])))),
  }))
}

export function exportarPDF({ titulo, sub, filas, columnas, archivo, orientacion }) {
  if (!filas?.length) return
  const cols = prepararColumnas(filas, columnas)
  const doc = new jsPDF({ orientation: orientacion || (cols.length > 7 ? 'landscape' : 'portrait'), unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()

  // Encabezado corporativo
  doc.setFillColor(22, 33, 62)
  doc.rect(0, 0, W, 22, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(13); doc.setFont(undefined, 'bold')
  doc.text('OUTLET DE PUERTAS SpA', 14, 9)
  doc.setFontSize(10); doc.setFont(undefined, 'normal')
  doc.text(titulo, 14, 16)
  doc.setFontSize(8)
  doc.text(`Emitido ${new Date().toLocaleString('es-CL')}`, W - 14, 9, { align: 'right' })
  if (sub) doc.text(String(sub).slice(0, 110), W - 14, 16, { align: 'right' })

  autoTable(doc, {
    startY: 27,
    head: [cols.map(c => c.l)],
    body: filas.map(f => cols.map(c => {
      const v = f[c.k]
      if (v == null) return ''
      if (c.num && v !== '' && !isNaN(Number(v))) return fmtCL(v)
      return String(v).slice(0, 90)
    })),
    styles: { fontSize: 7.5, cellPadding: 1.6, textColor: [28, 28, 30] },
    headStyles: { fillColor: [243, 244, 246], textColor: [22, 33, 62], fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: Object.fromEntries(cols.map((c, i) => [i, c.num ? { halign: 'right', font: 'courier' } : {}])),
    alternateRowStyles: { fillColor: [250, 250, 251] },
    didDrawPage: () => {
      const page = doc.internal.getCurrentPageInfo().pageNumber
      doc.setFontSize(7.5); doc.setTextColor(110, 110, 115)
      doc.text(`Página ${page}`, W - 14, doc.internal.pageSize.getHeight() - 6, { align: 'right' })
      doc.text('ERP Outlet de Puertas — informe generado desde el sistema', 14, doc.internal.pageSize.getHeight() - 6)
    },
  })
  doc.save(`${archivo || titulo.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.pdf`)
}
