import { useEffect, useMemo, useState } from 'react'
import { X, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { supabase } from '../../supabase'
import { formato } from './motor'

/* ═══ DETALLE KPI ═══
   Modal lateral (drawer) que muestra al pinchar un KPI o alerta.
   Contenido:
   - Composición (tabla con las líneas EERR que componen el KPI)
   - Evolución mensual (line chart)
   - Cambio vs período anterior
   - Top movimientos del período (carga bajo demanda desde Supabase)
*/

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export function DetalleKPI({ kpi, anio, mesHasta, lineasPorCodigo, onClose }) {
  const [topMovs, setTopMovs] = useState(null)
  const [loadingMovs, setLoadingMovs] = useState(false)
  const [tabSecundario, setTabSecundario] = useState('composicion')

  if (!kpi) return null

  // Determinar qué cuentas-madre cargar para top movimientos (si la composición tiene códigos EERR mapeados)
  useEffect(() => {
    if (!kpi.composicion || tabSecundario !== 'movimientos') return
    setLoadingMovs(true)
    cargarTopMovimientos(kpi.composicion.map(c => c.codigo), anio, mesHasta)
      .then(setTopMovs)
      .catch(() => setTopMovs([]))
      .finally(() => setLoadingMovs(false))
  }, [kpi.id, tabSecundario, anio, mesHasta])

  const evolucionChart = useMemo(() => {
    if (!kpi.evolucionPct) return null
    return kpi.evolucionPct.map((v, i) => ({ mes: MESES[i], valor: v }))
  }, [kpi.evolucionPct])

  const colorSemaforo = { verde: '#15803D', amarillo: '#B45309', rojo: '#DC2626' }[kpi.semaforo] || '#6B7280'

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)',
        zIndex: 100, backdropFilter: 'blur(2px)',
      }} />
      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(560px, 95vw)',
        background: '#fff', zIndex: 101, boxShadow: '-8px 0 32px rgba(0,0,0,0.15)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid #E5E7EB',
          background: '#F9FAFB',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              Detalle KPI
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
              {kpi.titulo}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                fontSize: 22, fontWeight: 700, fontFamily: 'monospace',
                color: colorSemaforo,
              }}>
                {kpi.formato === 'pct' ? formato.pct(kpi.valor) : formato.clp(kpi.valor)}
              </span>
              {kpi.cambio && <CambioBadge cambio={kpi.cambio} />}
            </div>
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>
              {kpi.sub} · Benchmark: {kpi.benchmark}
            </div>
          </div>
          <button onClick={onClose} style={{
            padding: 6, borderRadius: 6, border: 'none', background: '#fff',
            cursor: 'pointer', color: '#6B7280',
          }}>
            <X size={18} />
          </button>
        </div>

        {/* Explicación */}
        {kpi.explicacion && (
          <div style={{ padding: '14px 22px', borderBottom: '1px solid #F3F4F6', background: '#fff' }}>
            <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5, marginBottom: 6 }}>
              {kpi.explicacion}
            </div>
            {kpi.formula && (
              <div style={{ fontSize: 11, color: '#6B7280', fontFamily: 'monospace', background: '#F9FAFB', padding: '4px 8px', borderRadius: 4, display: 'inline-block' }}>
                {kpi.formula}
              </div>
            )}
          </div>
        )}

        {/* Sub-tabs */}
        <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #E5E7EB', padding: '0 22px', background: '#fff' }}>
          {[
            { k: 'composicion', l: 'Composición', visible: !!kpi.composicion },
            { k: 'evolucion',   l: 'Evolución',   visible: !!kpi.evolucionPct },
            { k: 'movimientos', l: 'Movimientos', visible: !!kpi.composicion },
          ].filter(t => t.visible).map(t => (
            <button key={t.k} onClick={() => setTabSecundario(t.k)} style={{
              padding: '10px 14px', fontSize: 12, fontWeight: 600,
              background: 'none', border: 'none', cursor: 'pointer',
              color: tabSecundario === t.k ? '#1F4E79' : '#8E8E93',
              borderBottom: tabSecundario === t.k ? '2px solid #1F4E79' : '2px solid transparent',
              marginBottom: -1,
            }}>{t.l}</button>
          ))}
        </div>

        {/* Contenido sub-tab */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', background: '#fff' }}>
          {tabSecundario === 'composicion' && kpi.composicion && (
            <Composicion items={kpi.composicion} />
          )}
          {tabSecundario === 'evolucion' && evolucionChart && (
            <EvolucionGrafico data={evolucionChart} mesHasta={mesHasta} formato={kpi.formato} />
          )}
          {tabSecundario === 'movimientos' && (
            <TopMovimientos movs={topMovs} loading={loadingMovs} anio={anio} mesHasta={mesHasta} />
          )}
        </div>
      </div>
    </>
  )
}

function CambioBadge({ cambio }) {
  if (!cambio) return null
  const positivo = cambio.pct >= 0
  const Icon = Math.abs(cambio.pct) < 0.5 ? Minus : positivo ? TrendingUp : TrendingDown
  const color = Math.abs(cambio.pct) < 0.5 ? '#6B7280' : positivo ? '#15803D' : '#DC2626'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 11, fontWeight: 700, color, background: color + '15',
      padding: '3px 7px', borderRadius: 4,
    }}>
      <Icon size={11} />
      {(cambio.pct >= 0 ? '+' : '') + cambio.pct.toFixed(1) + '%'}
    </span>
  )
}

function Composicion({ items }) {
  const total = items.reduce((s, it) => s + Math.abs(it.monto), 0)
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
        Composición del KPI
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map(it => {
          const peso = total > 0 ? Math.abs(it.monto) / total : 0
          const negativo = it.monto < 0
          return (
            <div key={it.codigo} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12 }}>
                <span style={{ color: '#111827', fontWeight: 500 }}>{it.nombre}</span>
                <span style={{ color: negativo ? '#DC2626' : '#111827', fontFamily: 'monospace', fontWeight: 600 }}>
                  {formato.clp(it.monto)}
                </span>
              </div>
              <div style={{ height: 4, background: '#F3F4F6', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: (peso * 100) + '%',
                  background: negativo ? '#DC2626' : '#1F4E79',
                  borderRadius: 2,
                }} />
              </div>
              <div style={{ fontSize: 10, color: '#9CA3AF' }}>
                {(peso * 100).toFixed(1)}% del total
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EvolucionGrafico({ data, mesHasta, formato: fmt }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
        Evolución mensual
      </div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" />
            <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmt === 'pct' ? v.toFixed(0) + '%' : v} />
            <Tooltip formatter={v => v !== null ? (fmt === 'pct' ? v.toFixed(1) + '%' : v) : '—'} />
            <Line type="monotone" dataKey="valor" stroke="#1F4E79" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 6, textAlign: 'center' }}>
        Mostrando datos hasta {MESES[mesHasta - 1]}
      </div>
    </div>
  )
}

function TopMovimientos({ movs, loading, anio, mesHasta }) {
  if (loading) return <div style={{ fontSize: 12, color: '#6B7280' }}>Cargando movimientos…</div>
  if (!movs || movs.length === 0) return <div style={{ fontSize: 12, color: '#9CA3AF' }}>No hay movimientos para este KPI en el período.</div>
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
        Top movimientos del período (enero - {MESES[mesHasta - 1]} {anio})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {movs.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 10px', background: '#F9FAFB', borderRadius: 6, fontSize: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.descripcion || '(sin descripción)'}</div>
              <div style={{ fontSize: 10, color: '#6B7280' }}>
                {m.fecha} · {m.cuenta_madre_nombre || '—'}
              </div>
            </div>
            <span style={{ fontFamily: 'monospace', color: '#DC2626', fontWeight: 600, marginLeft: 12 }}>
              {formato.clp(m.monto)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Fetch top movimientos del período para los códigos EERR dados ─── */
async function cargarTopMovimientos(codigosEerr, anio, mesHasta) {
  if (!codigosEerr || codigosEerr.length === 0) return []
  const yStart = anio + '-01-01'
  const yEndMes = anio + '-' + String(mesHasta).padStart(2, '0') + '-31'

  // Resolver cuentas_madre asociadas a esos códigos EERR vía eerr_mapeo
  const { data: lineas } = await supabase
    .from('eerr_lineas')
    .select('id, codigo')
    .in('codigo', codigosEerr)
  if (!lineas || lineas.length === 0) return []
  const lineaIds = lineas.map(l => l.id)

  const { data: mapeos } = await supabase
    .from('eerr_mapeo')
    .select('cuenta_madre_id')
    .in('eerr_linea_id', lineaIds)
  const cmIds = (mapeos || []).map(m => m.cuenta_madre_id)
  if (cmIds.length === 0) return []

  const { data: subs } = await supabase
    .from('subcuentas')
    .select('id, cuenta_madre_id')
    .in('cuenta_madre_id', cmIds)
  const subIds = (subs || []).map(s => s.id)
  if (subIds.length === 0) return []
  const subToCM = new Map(subs.map(s => [s.id, s.cuenta_madre_id]))

  // Cargar nombres de cuenta_madre
  const { data: cuentasM } = await supabase
    .from('cuentas_madre')
    .select('id, nombre')
    .in('id', cmIds)
  const cmIdToNombre = new Map((cuentasM || []).map(c => [c.id, c.nombre]))

  const { data: movs } = await supabase
    .from('movimientos_bancarios')
    .select('fecha, monto, descripcion, subcuenta_id')
    .gte('fecha', yStart)
    .lte('fecha', yEndMes)
    .lt('monto', 0)
    .in('subcuenta_id', subIds)
    .order('monto', { ascending: true })
    .limit(15)

  return (movs || []).map(m => ({
    fecha: m.fecha,
    descripcion: m.descripcion,
    monto: m.monto,
    cuenta_madre_nombre: cmIdToNombre.get(subToCM.get(m.subcuenta_id)) || '—',
  }))
}
