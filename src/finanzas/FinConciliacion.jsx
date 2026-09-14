import { useState } from 'react'
import { ConciliacionBancaria } from './ConciliacionBancaria'
import { ImportadorMovimientos } from './conciliacion/ImportadorMovimientos'
import { Global66Tab } from './conciliacion/Global66Tab'
import { PivotMovimientosTab } from './clasificar/PivotMovimientosTab'
import { ClasificarTab } from './clasificar/ClasificarTab'

/* ═══════════════════════════════════════════════════════════════════════
   CONCILIACIÓN BANCARIA — hoja del dominio Contabilidad
   Un objeto (la cartola), tres vistas:
     Conciliar  · banco de trabajo, línea a línea (lo que se usa a diario)
     Cartolas   · importar Santander / Global66 (inicio del flujo)
     Análisis   · pivot dinámico y clasificación masiva (herramientas)
   Lo que antes era "Documentos" y "Pagos" vive en la hoja Compras y pagos;
   "Control" vive en Libros y estados → Gobierno.
   ═══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', SLATE = '#6E6E73', BORDE = '#E5E7EB'

const TABS = [
  { k: 'conciliar', l: 'Conciliar' },
  { k: 'cartolas', l: 'Cartolas' },
  { k: 'analisis', l: 'Análisis dinámico' },
  { k: 'masivo', l: 'Clasificación masiva' },
]
// Claves antiguas que otras pantallas (Inicio) pueden seguir enviando por fin_conc_goto.
const LEGADO = { bandeja: 'conciliar', clasificar: 'conciliar', conciliar: 'conciliar', cartolas: 'cartolas', analisis: 'analisis' }

export function FinConciliacion({ cu, isMobile }) {
  const [tab, setTab] = useState(() => {
    try { const g = localStorage.getItem('fin_conc_goto'); if (g) { localStorage.removeItem('fin_conc_goto'); return LEGADO[g] ?? 'conciliar' } } catch (e) { }
    return 'conciliar'
  })
  const [cuenta, setCuenta] = useState('santander')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${BORDE}`, overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            padding: '7px 14px', fontSize: 12, fontWeight: tab === t.k ? 700 : 500, whiteSpace: 'nowrap',
            background: 'none', border: 'none', cursor: 'pointer', color: tab === t.k ? NAVY : SLATE,
            borderBottom: `2px solid ${tab === t.k ? NAVY : 'transparent'}`, marginBottom: -1,
          }}>{t.l}</button>
        ))}
      </div>

      {tab === 'conciliar' && <ConciliacionBancaria cu={cu} />}

      {tab === 'cartolas' && (
        <div>
          <div style={{ display: 'flex', gap: 6, padding: 4, background: '#F3F4F6', borderRadius: 8, marginBottom: 12, width: 'fit-content' }}>
            {[['santander', 'Santander (CLP)'], ['global66', 'Global66 (USD)']].map(([k, l]) => (
              <button key={k} onClick={() => setCuenta(k)} style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', borderRadius: 6,
                background: cuenta === k ? '#fff' : 'transparent', color: cuenta === k ? NAVY : SLATE,
                boxShadow: cuenta === k ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}>{l}</button>
            ))}
          </div>
          {cuenta === 'santander' && <ImportadorMovimientos onImportado={() => setTab('conciliar')} />}
          {cuenta === 'global66' && <Global66Tab />}
        </div>
      )}

      {tab === 'analisis' && <PivotMovimientosTab />}
      {tab === 'masivo' && <ClasificarTab />}
    </div>
  )
}
