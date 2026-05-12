import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../supabase'
import { ClasificarTab } from './clasificar/ClasificarTab'
import { ConciliarRespaldosTab } from './conciliacion/ConciliarRespaldosTab'
import { Loader2, Upload } from 'lucide-react'

const cardSt = { background: '#fff', borderRadius: 10, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 16 }
const TH = { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase', background: '#F9FAFB', whiteSpace: 'nowrap' }
const TD = { padding: '10px 12px', fontSize: 13, color: '#374151', whiteSpace: 'nowrap', verticalAlign: 'middle' }

function CartolasView({ showToast }) {
  const [cartolas, setCartolas] = useState([])
  const [uploadLoading, setUploadLoading] = useState(false)

  useEffect(() => {
    supabase.from('cartolas').select('*').order('periodo_desde', { ascending: false })
      .then(({ data }) => setCartolas(data || []))
  }, [])

  async function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploadLoading(true)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false })
      showToast(`Archivo leído: ${rows.length} filas detectadas.`)
    } catch (err) {
      showToast('Error al leer el archivo: ' + err.message, 'err')
    } finally {
      setUploadLoading(false)
      e.target.value = ''
    }
  }

  return (
    <div>
      <div style={cardSt}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 12 }}>Cargar cartola bancaria</div>
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '10px 16px', background: '#EFF6FF', color: '#1F4E79',
          borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
          border: '1px solid #BFDBFE'
        }}>
          {uploadLoading ? <Loader2 size={14} /> : <Upload size={14} />}
          {uploadLoading ? 'Procesando...' : 'Cargar cartola Excel'}
          <input type="file" accept=".xlsx,.xls" onChange={handleUpload} style={{ display: 'none' }} />
        </label>
      </div>

      <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={TH}>Banco</th>
              <th style={TH}>Período desde</th>
              <th style={TH}>Período hasta</th>
              <th style={TH}>Cargada</th>
            </tr>
          </thead>
          <tbody>
            {cartolas.map(c => (
              <tr key={c.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                <td style={TD}>{c.banco}</td>
                <td style={TD}>{c.periodo_desde}</td>
                <td style={TD}>{c.periodo_hasta}</td>
                <td style={{ ...TD, color: '#9CA3AF' }}>{new Date(c.created_at).toLocaleDateString('es-CL')}</td>
              </tr>
            ))}
            {cartolas.length === 0 && (
              <tr>
                <td colSpan={4} style={{ ...TD, textAlign: 'center', padding: '32px 0', color: '#9CA3AF' }}>
                  Sin cartolas cargadas
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function FinConciliacion({ cu, isMobile }) {
  const [subTab, setSubTab] = useState('clasificar')
  const [toast_, setToast] = useState(null)

  function showToast(msg, tipo = 'ok') {
    setToast({ msg, tipo })
    setTimeout(() => setToast(null), 3000)
  }

  const TABS = [
    { k: 'clasificar', l: 'Clasificar' },
    { k: 'cartolas', l: 'Cartolas' },
    { k: 'conciliar', l: 'Conciliar con respaldos' },
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
      {subTab === 'cartolas' && <CartolasView showToast={showToast} />}
      {subTab === 'conciliar' && <ConciliarRespaldosTab />}

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
