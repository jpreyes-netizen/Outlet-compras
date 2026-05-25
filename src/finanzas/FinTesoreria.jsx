import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { CierreDelDiaTab } from './tesoreria/CierreDelDiaTab'
import { DepositosAbonosTab } from './tesoreria/DepositosAbonosTab'
import { AnalisisTab } from './tesoreria/AnalisisTab'
import { CartolaBancariaTab } from './tesoreria/CartolaBancariaTab'

const ALL_TABS = [
  { k: 'cierre',    l: 'Cierre del día',    roles: ['admin','dir_general','dir_finanzas','tesorero','cajero'] },
  { k: 'depositos', l: 'Depósitos y abonos', roles: ['admin','dir_general','dir_finanzas','tesorero','cajero'] },
  { k: 'cartola',   l: 'Cartola bancaria',   roles: ['admin','dir_general','dir_finanzas','tesorero'] },
  { k: 'analisis',  l: 'Análisis',           roles: ['admin','dir_general','dir_finanzas','tesorero'] },
]

export function FinTesoreria({ cu, isMobile, rol }) {
  const rolActual = rol || cu?.rol || 'cajero'
  const TABS = ALL_TABS.filter(t => t.roles.includes(rolActual) || rolActual === 'admin')
  const [tab, setTab] = useState('cierre')
  const [usuario, setUsuario] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('usuarios').select('id, nombre, rol, sucursal_id').eq('id', cu.id).maybeSingle()
      .then(({ data }) => setUsuario(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [cu.id])

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF', fontSize: 13 }}>Cargando...</div>
  )

  if (!usuario) return (
    <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF', fontSize: 13 }}>No se pudo cargar el usuario.</div>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 2, marginBottom: 16, borderBottom: '1px solid rgba(0,0,0,0.06)', overflowX: 'auto' }}>
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t.k ? '#1F4E79' : '#8E8E93',
            borderBottom: tab === t.k ? '2px solid #1F4E79' : '2px solid transparent',
          }}>{t.l}</button>
        ))}
      </div>

      {tab === 'cierre'    && <CierreDelDiaTab    usuario={usuario} />}
      {tab === 'depositos' && <DepositosAbonosTab usuario={usuario} />}
      {tab === 'cartola'   && <CartolaBancariaTab usuario={usuario} />}
      {tab === 'analisis'  && <AnalisisTab        usuario={usuario} />}
    </div>
  )
}
