// ManualDrawer.jsx — Drawer lateral con manual e índice de flujogramas
// Disponible para cualquier usuario logueado en el módulo Tesorería.
// Archivos servidos estáticos desde /docs/tesoreria/ (carpeta public del repo).
import { useState } from 'react'
import { X, FileText, FileImage, Download, ExternalLink, BookOpen } from 'lucide-react'

const DOCS_BASE = '/docs/tesoreria'

const SECCIONES = [
  {
    titulo: 'Manual completo',
    descripcion: 'Manual operativo de Tesorería — declaración, corroboración, depósitos',
    items: [
      {
        nombre: 'Manual de Tesorería v1.0',
        descripcion: '9 secciones · paso a paso · casos de uso · troubleshooting',
        pdf: `${DOCS_BASE}/Manual_Tesoreria_v1.pdf`,
        docx: `${DOCS_BASE}/Manual_Tesoreria_v1.docx`,
        tipo: 'doc',
      },
    ],
  },
  {
    titulo: 'Flujogramas',
    descripcion: 'Diagramas visuales de cada proceso',
    items: [
      {
        nombre: 'Flujograma macro · end-to-end',
        descripcion: 'Vista completa: venta → declaración → corroboración → depósito → conciliación',
        svg: `${DOCS_BASE}/flujograma_01_macro.svg`,
        tipo: 'svg',
      },
      {
        nombre: 'Declaración de cierre (cajero)',
        descripcion: '9 pasos del cajero al cerrar la caja del día',
        svg: `${DOCS_BASE}/flujograma_02_declaracion.svg`,
        tipo: 'svg',
      },
      {
        nombre: 'Corroboración de cierre (admin/jefe)',
        descripcion: 'Conteo de efectivo, validaciones, clasificación de estado',
        svg: `${DOCS_BASE}/flujograma_03_corroboracion.svg`,
        tipo: 'svg',
      },
      {
        nombre: 'Depósito de efectivo (analista)',
        descripcion: 'Vinculación con cierre + subida de comprobante',
        svg: `${DOCS_BASE}/flujograma_04_deposito.svg`,
        tipo: 'svg',
      },
    ],
  },
]

export function ManualDrawer({ onClose }) {
  const [preview, setPreview] = useState(null) // url del archivo en preview

  return (
    <>
      {/* Overlay del drawer */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.45)', zIndex: 9998,
        }}
      />

      {/* Drawer */}
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 480, maxWidth: '100%', background: '#fff',
        boxShadow: '-4px 0 32px rgba(0,0,0,0.18)', zIndex: 9999,
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          padding: '20px 24px', color: '#fff',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <BookOpen size={20} />
              <span style={{ fontSize: 17, fontWeight: 700 }}>Manual de Tesorería</span>
            </div>
            <div style={{ fontSize: 11, color: '#9CA3AF' }}>
              Documentación operativa · Outlet de Puertas SpA
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar"
            style={{
              background: 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer',
              color: '#fff', padding: 6, borderRadius: 6, display: 'flex',
            }}>
            <X size={16} />
          </button>
        </div>

        {/* Contenido */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {SECCIONES.map((sec, i) => (
            <div key={i} style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
                {sec.titulo}
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 12 }}>
                {sec.descripcion}
              </div>

              {sec.items.map((it, j) => (
                <div key={j} style={{
                  background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8,
                  padding: '12px 14px', marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{
                      background: it.tipo === 'doc' ? '#DBEAFE' : '#FEF3C7',
                      color: it.tipo === 'doc' ? '#1E40AF' : '#92400E',
                      width: 32, height: 32, borderRadius: 6,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {it.tipo === 'doc' ? <FileText size={16} /> : <FileImage size={16} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', marginBottom: 2 }}>
                        {it.nombre}
                      </div>
                      <div style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.4 }}>
                        {it.descripcion}
                      </div>
                    </div>
                  </div>

                  {/* Acciones */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    {it.tipo === 'doc' && (
                      <>
                        <button onClick={() => setPreview(it.pdf)} style={btnSecondary}>
                          <ExternalLink size={11} /> Ver
                        </button>
                        <a href={it.pdf} download style={btnSecondary}>
                          <Download size={11} /> PDF
                        </a>
                        <a href={it.docx} download style={btnSecondary}>
                          <Download size={11} /> Word
                        </a>
                      </>
                    )}
                    {it.tipo === 'svg' && (
                      <>
                        <button onClick={() => setPreview(it.svg)} style={btnSecondary}>
                          <ExternalLink size={11} /> Ver
                        </button>
                        <a href={it.svg} download style={btnSecondary}>
                          <Download size={11} /> Descargar
                        </a>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}

          {/* Footer informativo */}
          <div style={{
            marginTop: 20, padding: '12px 14px',
            background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 8,
            fontSize: 11, color: '#0369A1', lineHeight: 1.5,
          }}>
            <strong>¿Encuentras un error en el manual?</strong> Avísale a Juan Pablo Reyes
            (jpreyes@outletdepuertas.cl) para actualizarlo. Versión actual: v1.0 · Jun 2026.
          </div>
        </div>
      </aside>

      {/* Modal de preview para visualizar archivos sin salir de la app */}
      {preview && (
        <div
          onClick={() => setPreview(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 10, width: '95%', height: '95%',
            maxWidth: 1400, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid #E5E7EB',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
                Vista previa
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <a href={preview} target="_blank" rel="noopener noreferrer" style={btnSecondary}>
                  <ExternalLink size={11} /> Nueva pestaña
                </a>
                <button onClick={() => setPreview(null)} style={btnSecondary}>
                  <X size={11} /> Cerrar
                </button>
              </div>
            </div>
            <iframe src={preview} style={{ flex: 1, border: 'none', background: '#F9FAFB' }} title="Preview" />
          </div>
        </div>
      )}
    </>
  )
}

const btnSecondary = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 10px', fontSize: 11, fontWeight: 600,
  background: '#fff', color: '#374151',
  border: '1px solid #D1D5DB', borderRadius: 6,
  cursor: 'pointer', textDecoration: 'none',
}
