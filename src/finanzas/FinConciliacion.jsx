import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { ClasificarTab } from './clasificar/ClasificarTab'
import { ConciliarRespaldosTab } from './conciliacion/ConciliarRespaldosTab'
import { ImportadorMovimientos } from './conciliacion/ImportadorMovimientos'
import { PivotMovimientosTab } from './clasificar/PivotMovimientosTab'
import { FlujoCajaTab } from './clasificar/FlujoCajaTab'

const cardSt = { background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 16 }
const TH = { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase', background: '#F9FAFB', whiteSpace: 'nowrap' }
const TD = { padding: '10px 12px', fontSize: 13, color: '#374151', whiteSpace: 'nowrap', verticalAlign: 'middle' }

export function FinConciliacion({ cu, isMobile }) {
  const [subTab, setSubTab] = useState('clasificar')
  const [toast_, setToast] = useState(null)

  function showToast(msg, tipo = 'ok') {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  const TABS = [
    { k: 'clasificar', l: 'Clasificar' },
    { k: 'analisis',   l: 'Análisis dinámico' },
    { k: 'flujo',      l: 'Flujo de caja' },
    { k: 'cartolas',   l: 'Cartolas' },
    { k: 'conciliar',  l: 'Conciliar con respaldos' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        {TABS.map(({ k, l }) => (
          <button key={k} onClick={() => setSubTab(k)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 600,
            background: 'none', border: 'none', cursor: 'pointer',
            color: subTab === k ? '#1F4E79' : '#8E8E93',
            borderBottom: subTab === k ? '2px solid #1F4E79' : '2px solid transparent',
          }}>{l}</button>
        ))}
      </div>

      {subTab === 'clasificar' && <ClasificarTab />}
      {subTab === 'analisis'   && <PivotMovimientosTab />}
      {subTab === 'flujo'      && <FlujoCajaTab />}
      {subTab === 'cartolas'   && <ImportadorMovimientos onImportado={() => showToast('Cartola importada — ve a Clasificar para procesar los movimientos')} />}
      {subTab === 'conciliar'  && <ConciliarRespaldosTab />}

      {toast_ && (
        <div style={{
          position: 'fixed', bottom: 100, right: 20, zIndex: 200,
          background: toast_.tipo === 'err' ? '#DC2626' : '#16A34A',
          color: '#fff', borderRadius: 10, padding: '10px 16px',
          fontSize: 13, fontWeight: 600, boxShadow: '0 4px 16px rgba(0,0,0,0.15)'
        }}>{toast_.msg}</div>
      )}
    </div>
  )
}
