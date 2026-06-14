import { useState } from 'react'
import { CartolaBancariaTab } from './CartolaBancariaTab'
import { Global66Tab } from './Global66Tab'

/* ═══ CARTOLA WRAPPER ═══
   Agrupa Santander + Global66 bajo el tab "Cartola Bancaria" de Tesorería.
   - Santander: la CartolaBancariaTab original (sin cambios)
   - Global66:  cartola fintech USD para importaciones
*/

export function CartolaWrapper({ usuario }) {
  const [cuenta, setCuenta] = useState('santander') // santander | global66

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 6, padding: '4px 4px', background: '#F3F4F6', borderRadius: 10, alignSelf: 'flex-start' }}>
        {[
          { k: 'santander', l: '🏦 Santander', c: '#15803D' },
          { k: 'global66',  l: '🌐 Global66 (USD)', c: '#7C3AED' },
        ].map(t => (
          <button key={t.k} onClick={() => setCuenta(t.k)} style={{
            padding: '7px 16px', fontSize: 13, fontWeight: 600,
            border: 'none', cursor: 'pointer', borderRadius: 7,
            background: cuenta === t.k ? '#fff' : 'transparent',
            color: cuenta === t.k ? t.c : '#6B7280',
            boxShadow: cuenta === t.k ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
          }}>{t.l}</button>
        ))}
      </div>

      {cuenta === 'santander' && <CartolaBancariaTab usuario={usuario} />}
      {cuenta === 'global66' && <Global66Tab />}
    </div>
  )
}
