import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { CierreDelDiaTab } from './tesoreria/CierreDelDiaTab'
import { DepositosAbonosTab } from './tesoreria/DepositosAbonosTab'
import { CuadraturaTab } from './tesoreria/CuadraturaTab'
import { AnalisisTab } from './tesoreria/AnalisisTab'
import { ConciliacionMediosTab } from './tesoreria/ConciliacionMediosTab'

const TABS = [
  { k: 'declarar', l: 'Declarar cierre' },
  { k: 'corroborar', l: 'Corroborar' },
  { k: 'depositos', l: 'Depósitos y abonos' },
  { k: 'cuadratura', l: 'Cuadratura' },
  { k: 'analisis',     l: 'Análisis'            },
  { k: 'conciliacion', l: 'Conciliación Medios' },
]

export function FinTesoreria({ cu, isMobile }) {
  const [tab, setTab] = useState('declarar')
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
      {/* Tabs */}
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

      {tab === 'cierre' && <CierreDelDiaTab usuario={usuario} />}
      {tab === 'depositos' && <DepositosAbonosTab usuario={usuario} />}
      {tab === 'cuadratura' && <CuadraturaTab usuario={usuario} />}
      {tab === 'analisis'     && <AnalisisTab           usuario={usuario} />}
      {tab === 'conciliacion' && <ConciliacionMediosTab usuario={usuario} />}
    </div>
  )
}
