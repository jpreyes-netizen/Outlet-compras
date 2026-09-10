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

export async function abrirFuente(setDet, { titulo, sub, query, limite = 3000 }) {
  setDet({ titulo, sub, filas: [], cargando: true })
  const { data, error } = await query.limit(limite)
  setDet({ titulo, sub: error ? `Error: ${error.message}` : sub, filas: data ?? [], cargando: false })
}

export function FuenteDrawer({ det, onClose }) {
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
                  <tr key={i}>
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
    </div>
  )
}
