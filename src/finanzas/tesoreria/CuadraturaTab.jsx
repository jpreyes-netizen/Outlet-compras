import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Download, Loader2 } from 'lucide-react'
import { formatCLP, cardSt, selectSt, labelSt, btnOutlineSt, TH, TD, estadoBadge } from './types'
import { fetchCierres, fetchKpisMes, fetchSucursales } from './api'

const PUEDE_TODO = ['admin', 'contabilidad', 'jefe_admin_finanzas', 'gerente_admin_finanzas', 'gerencia', 'admin_sistema']

function KpiCard({ title, value, color }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9CA3AF', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? '#111827' }}>{value}</div>
    </div>
  )
}

export function CuadraturaTab({ usuario }) {
  const now = new Date()
  const [anio, setAnio] = useState(now.getFullYear())
  const [mes, setMes] = useState(now.getMonth() + 1)
  const puedeElegirSuc = PUEDE_TODO.includes(usuario.rol)
  const [sucursales, setSucursales] = useState([])
  const [sucursal, setSucursal] = useState(puedeElegirSuc ? 'all' : (usuario.sucursal_id ?? ''))
  const [cierres, setCierres] = useState([])
  const [kpis, setKpis] = useState(null)
  const [loadingCierres, setLoadingCierres] = useState(true)
  const [loadingKpis, setLoadingKpis] = useState(true)

  const sucursalEf = sucursal === 'all' ? null : sucursal || null
  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`
  const fin = new Date(anio, mes, 0)
  const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(fin.getDate()).padStart(2, '0')}`
  const anios = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

  useEffect(() => { fetchSucursales().then(setSucursales).catch(() => {}) }, [])

  useEffect(() => {
    setLoadingCierres(true)
    fetchCierres({ sucursal_id: sucursalEf, fecha_desde: desde, fecha_hasta: hasta })
      .then(setCierres).catch(e => toast.error(e.message)).finally(() => setLoadingCierres(false))
  }, [sucursalEf, desde, hasta])

  useEffect(() => {
    setLoadingKpis(true)
    fetchKpisMes({ anio, mes, sucursal_id: sucursalEf })
      .then(setKpis).catch(() => setKpis(null)).finally(() => setLoadingKpis(false))
  }, [anio, mes, sucursalEf])

  function exportarCSV() {
    const headers = ['fecha', 'sucursal', 'vendedor', 'bsale_api', 'declarado', 'brecha_bsale', 'corroborado', 'diferencia', 'estado']
    const rows = cierres.map(c => [c.fecha, c.sucursal_nombre ?? '', c.vendedor_nombre ?? '', c.venta_bsale_api ?? '', c.total_declarado ?? '', c.brecha_bsale ?? '', c.total_corroborado ?? '', c.diferencia ?? '', c.estado])
    const csv = [headers, ...rows].map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `cuadratura_${anio}-${String(mes).padStart(2, '0')}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Filtros */}
      <div style={cardSt}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label style={labelSt}>Año</label>
            <select style={selectSt} value={String(anio)} onChange={e => setAnio(Number(e.target.value))}>
              {anios.map(a => <option key={a} value={String(a)}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={labelSt}>Mes</label>
            <select style={selectSt} value={String(mes)} onChange={e => setMes(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={String(m)}>{String(m).padStart(2, '0')}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelSt}>Sucursal</label>
            <select style={selectSt} value={sucursal} disabled={!puedeElegirSuc} onChange={e => setSucursal(e.target.value)}>
              {puedeElegirSuc && <option value="all">Todas</option>}
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button onClick={exportarCSV} disabled={cierres.length === 0} style={{ ...btnOutlineSt, width: '100%', justifyContent: 'center', opacity: cierres.length === 0 ? 0.5 : 1 }}>
              <Download size={13} /> CSV
            </button>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <KpiCard title="Ventas BSALE mes" value={loadingKpis ? '…' : formatCLP(kpis?.ventasBsale)} color="#1F4E79" />
        <KpiCard title="Total depositado" value={loadingKpis ? '…' : formatCLP(kpis?.totalDepositado)} color="#16A34A" />
        <KpiCard title="Brecha mensual" value={loadingKpis ? '…' : formatCLP(kpis?.brechaTotal)} />
        <KpiCard title="Pendientes corroborar" value={loadingKpis ? '…' : String(kpis?.pendientes ?? 0)} color="#D97706" />
        <KpiCard title="Descuadres" value={loadingKpis ? '…' : String(kpis?.descuadres ?? 0)} color={(kpis?.descuadres ?? 0) > 0 ? '#DC2626' : '#111827'} />
      </div>

      {/* Tabla */}
      <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #F3F4F6', fontSize: 14, fontWeight: 600, color: '#111827' }}>
          Detalle del mes
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Fecha', 'Sucursal', 'Vendedor', 'BSALE', 'Declarado', 'Brecha BSALE', 'Corroborado', 'Diferencia', 'Estado'].map(h => (
                  <th key={h} style={{ ...TH, textAlign: ['BSALE', 'Declarado', 'Brecha BSALE', 'Corroborado', 'Diferencia'].includes(h) ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingCierres && <tr><td colSpan={9} style={{ ...TD, textAlign: 'center', padding: '40px 0' }}><Loader2 size={20} style={{ display: 'inline-block', color: '#9CA3AF' }} /></td></tr>}
              {!loadingCierres && cierres.length === 0 && <tr><td colSpan={9} style={{ ...TD, textAlign: 'center', padding: '40px 0', color: '#9CA3AF' }}>Sin cierres en este filtro</td></tr>}
              {!loadingCierres && cierres.map(c => {
                const difColor = c.diferencia == null ? '#374151' : Math.abs(Number(c.diferencia)) === 0 ? '#16A34A' : '#DC2626'
                return (
                  <tr key={c.id} style={{ borderTop: '1px solid #F3F4F6' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#F9FAFB'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={TD}>{c.fecha}</td>
                    <td style={TD}>{c.sucursal_nombre ?? '—'}</td>
                    <td style={TD}>{c.vendedor_nombre ?? '—'}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>{c.venta_bsale_api == null ? '—' : formatCLP(c.venta_bsale_api)}</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{formatCLP(c.total_declarado)}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>{formatCLP(c.brecha_bsale)}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>{c.total_corroborado == null ? '—' : formatCLP(c.total_corroborado)}</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 600, color: difColor }}>{c.diferencia == null ? '—' : formatCLP(c.diferencia)}</td>
                    <td style={TD}>{estadoBadge(c.estado)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
