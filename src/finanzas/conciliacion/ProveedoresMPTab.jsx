import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Download, Search, X, ChevronDown, ChevronRight, Building2, TrendingUp, Calendar, BarChart3, AlertCircle } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'
import { MESES_CORTOS } from '../clasificar/types'

const PRIMARY = '#1F4E79'

function fmtCLP(n) {
  if (n == null || n === 0) return '—'
  return '$' + Math.round(Math.abs(n)).toLocaleString('es-CL')
}

function fmtFecha(f) {
  if (!f) return '—'
  const [a, m, d] = f.split('-')
  return `${d}/${m}/${a}`
}

// ── Extrae el nombre del proveedor desde la descripción ──
function extraerProveedor(desc) {
  if (!desc) return 'Sin descripción'
  let s = desc.trim()
  s = s.replace(/^\d{9,}\s+/, '')  // quita número de doc inicial
  let m = s.match(/(?:Transf a|Pago (?:de|a))\s+(.+)/i)
  if (m) return normalizarNombre(m[1])
  return normalizarNombre(s)
}

function normalizarNombre(s) {
  return s.trim()
    .replace(/\s+/g, ' ')
    .replace(/\.+$/, '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.03em', background: '#F1F5F9', whiteSpace: 'nowrap' }
const TD = { padding: '6px 10px', fontSize: 12, color: '#374151', verticalAlign: 'middle', borderBottom: '1px solid #F1F5F9' }

export function ProveedoresMPTab() {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [anio, setAnio]         = useState(new Date().getFullYear())
  const [filtroCM, setFiltroCM] = useState('')
  const [filtroSC, setFiltroSC] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [vista, setVista]       = useState('resumen')
  const [expanded, setExpanded] = useState(new Set())

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      setLoading(true)
      try {
        const desde = `${anio}-01-01`, hasta = `${anio}-12-31`
        const { data: cmData, error: errCm } = await supabase
          .from('cuentas_madre')
          .select('id, nombre, codigo')
          .ilike('nombre', '%materia%prima%')
        if (errCm) throw errCm
        const cuentasMadre = cmData ?? []
        const cmIds = cuentasMadre.map(c => c.id)

        const { data: scData } = await supabase
          .from('subcuentas')
          .select('id, nombre, cuenta_madre_id')
          .in('cuenta_madre_id', cmIds)
        const subcuentas = scData ?? []
        const scIds = subcuentas.map(s => s.id)

        const { data: movs, error: errMov } = await supabase
          .from('movimientos_bancarios')
          .select('id, fecha, descripcion, monto, subcuenta_id, tipo, mes_nominal')
          .eq('tipo', 'CARGO')
          .eq('estado', 'clasificado')
          .in('subcuenta_id', scIds)
          .gte('fecha', desde).lte('fecha', hasta)
          .limit(20000)
        if (errMov) throw errMov

        const cmById = new Map(cuentasMadre.map(c => [c.id, c]))
        const scById = new Map(subcuentas.map(s => [s.id, s]))

        if (!cancelado) {
          setData({ cuentasMadre, subcuentas, cmById, scById, movimientos: movs ?? [] })
        }
      } catch (e) {
        toast.error('Error cargando: ' + (e instanceof Error ? e.message : '?'))
        if (!cancelado) setData(null)
      } finally { if (!cancelado) setLoading(false) }
    })()
    return () => { cancelado = true }
  }, [anio])

  const procesado = useMemo(() => {
    if (!data) return null
    let movs = data.movimientos
    if (filtroCM) {
      const scsValidas = new Set(data.subcuentas.filter(s => s.cuenta_madre_id === filtroCM).map(s => s.id))
      movs = movs.filter(m => scsValidas.has(m.subcuenta_id))
    }
    if (filtroSC) movs = movs.filter(m => m.subcuenta_id === filtroSC)

    movs = movs.map(m => {
      const sc = data.scById.get(m.subcuenta_id)
      const cm = sc ? data.cmById.get(sc.cuenta_madre_id) : null
      return {
        ...m,
        proveedor: extraerProveedor(m.descripcion),
        subcuenta_nombre: sc?.nombre ?? '—',
        cuenta_madre_nombre: cm?.nombre ?? '—',
        cuenta_madre_id: sc?.cuenta_madre_id,
      }
    })

    if (busqueda.trim()) {
      const b = busqueda.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
      movs = movs.filter(m => m.proveedor.includes(b))
    }

    const porProveedor = new Map()
    for (const m of movs) {
      if (!porProveedor.has(m.proveedor)) {
        porProveedor.set(m.proveedor, {
          proveedor: m.proveedor, pagos: [], total: 0,
          subcuentas: new Map(), mesesMonto: new Array(13).fill(0),
          primer_pago: null, ultimo_pago: null,
        })
      }
      const g = porProveedor.get(m.proveedor)
      g.pagos.push(m)
      const monto = Math.abs(Number(m.monto) || 0)
      g.total += monto
      const mes = m.mes_nominal ?? Number(m.fecha.slice(5, 7))
      g.mesesMonto[mes] += monto
      g.subcuentas.set(m.subcuenta_nombre, (g.subcuentas.get(m.subcuenta_nombre) ?? 0) + monto)
      if (!g.primer_pago || m.fecha < g.primer_pago) g.primer_pago = m.fecha
      if (!g.ultimo_pago || m.fecha > g.ultimo_pago) g.ultimo_pago = m.fecha
    }
    const proveedores = Array.from(porProveedor.values()).sort((a, b) => b.total - a.total)

    const porCM = new Map()
    for (const m of movs) {
      const key = m.cuenta_madre_nombre
      porCM.set(key, (porCM.get(key) ?? 0) + Math.abs(Number(m.monto) || 0))
    }
    const cuentasMadreData = Array.from(porCM.entries()).map(([nombre, total]) => ({ nombre, total })).sort((a, b) => b.total - a.total)

    const totalGeneral = movs.reduce((s, m) => s + Math.abs(Number(m.monto) || 0), 0)
    const ticketPromedio = movs.length ? totalGeneral / movs.length : 0
    const top1 = proveedores[0]

    return { movs, proveedores, cuentasMadreData, totalGeneral, ticketPromedio, top1 }
  }, [data, filtroCM, filtroSC, busqueda])

  const subcuentasFiltradas = useMemo(() => {
    if (!data) return []
    if (!filtroCM) return data.subcuentas
    return data.subcuentas.filter(s => s.cuenta_madre_id === filtroCM)
  }, [data, filtroCM])

  function toggleProveedor(prov) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(prov) ? next.delete(prov) : next.add(prov)
      return next
    })
  }

  function exportarExcel() {
    if (!procesado) return
    const wb = XLSX.utils.book_new()
    const h1 = ['Proveedor', 'Total pagado', '# Pagos', '% del total', 'Primer pago', 'Último pago', 'Subcuentas usadas']
    const r1 = procesado.proveedores.map(p => [
      p.proveedor, p.total, p.pagos.length,
      procesado.totalGeneral ? `${((p.total / procesado.totalGeneral) * 100).toFixed(1)}%` : '0%',
      p.primer_pago, p.ultimo_pago,
      Array.from(p.subcuentas.keys()).join(' · '),
    ])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([h1, ...r1]), 'Por proveedor')

    const h2 = ['Fecha', 'Proveedor', 'Subcuenta', 'Cuenta madre', 'Monto', 'Descripción original']
    const r2 = procesado.movs.map(m => [m.fecha, m.proveedor, m.subcuenta_nombre, m.cuenta_madre_nombre, Math.abs(m.monto), m.descripcion])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([h2, ...r2]), 'Detalle')

    const h3 = ['Proveedor', ...MESES_CORTOS, 'Total']
    const r3 = procesado.proveedores.map(p => [p.proveedor, ...p.mesesMonto.slice(1).map(v => v || 0), p.total])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([h3, ...r3]), 'Pivot mensual')

    XLSX.writeFile(wb, `pagos_proveedores_mp_${anio}.xlsx`)
  }

  const aniosOpts = [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: '#fff', borderRadius: 10, padding: '14px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Building2 size={18} color={PRIMARY} /> Pagos a Proveedores · Materia Prima
            </div>
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
              Pagos clasificados en las 4 cuentas madre de Materia Prima (Importación, Inversión, Reposición, Transportes)
            </div>
          </div>
          <button onClick={exportarExcel} disabled={!procesado || loading}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: 'none', background: PRIMARY, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: !procesado || loading ? 0.5 : 1 }}>
            <Download size={13} /> Exportar Excel
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Año</div>
            <select value={anio} onChange={e => setAnio(Number(e.target.value))}
              style={{ padding: '5px 9px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff', cursor: 'pointer' }}>
              {aniosOpts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Cuenta madre</div>
            <select value={filtroCM} onChange={e => { setFiltroCM(e.target.value); setFiltroSC('') }}
              style={{ padding: '5px 9px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff', cursor: 'pointer', minWidth: 200 }}>
              <option value="">Todas</option>
              {data?.cuentasMadre.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Subcuenta</div>
            <select value={filtroSC} onChange={e => setFiltroSC(e.target.value)}
              style={{ padding: '5px 9px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff', cursor: 'pointer', minWidth: 220 }}>
              <option value="">Todas</option>
              {subcuentasFiltradas.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Buscar proveedor</div>
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
              <input type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre proveedor..."
                style={{ width: '100%', padding: '5px 9px 5px 26px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff' }} />
              {busqueda && (
                <button onClick={() => setBusqueda('')} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}>
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {procesado && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <KPI label="Total pagado" valor={fmtCLP(procesado.totalGeneral)} icon={<TrendingUp size={16} />} color="#DC2626" />
          <KPI label="# Proveedores" valor={procesado.proveedores.length} icon={<Building2 size={16} />} color="#1F4E79" />
          <KPI label="# Pagos" valor={procesado.movs.length} icon={<Calendar size={16} />} color="#0369A1" />
          <KPI label="Ticket promedio" valor={fmtCLP(procesado.ticketPromedio)} icon={<BarChart3 size={16} />} color="#7C3AED" />
          {procesado.top1 && (
            <KPI label="Proveedor #1" valor={procesado.top1.proveedor}
              extra={`${fmtCLP(procesado.top1.total)} · ${procesado.totalGeneral ? ((procesado.top1.total / procesado.totalGeneral) * 100).toFixed(1) : 0}%`}
              icon={<Building2 size={16} />} color="#059669" compact />
          )}
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 10, padding: '10px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', gap: 4 }}>
        {[
          { k: 'resumen',    l: '📊 Resumen' },
          { k: 'proveedor',  l: '🏢 Por proveedor' },
          { k: 'cronologia', l: '📅 Cronología' },
        ].map(({ k, l }) => (
          <button key={k} onClick={() => setVista(k)} style={{
            padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
            background: vista === k ? PRIMARY : 'transparent',
            color: vista === k ? '#fff' : '#475569',
            fontSize: 12, fontWeight: 600,
          }}>{l}</button>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <Loader2 size={22} style={{ display: 'inline-block', color: '#9CA3AF' }} />
            <div style={{ marginTop: 8, fontSize: 12, color: '#9CA3AF' }}>Cargando pagos...</div>
          </div>
        ) : !procesado || procesado.movs.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: '#9CA3AF' }}>
            <AlertCircle size={36} style={{ display: 'inline-block', marginBottom: 10, opacity: 0.4 }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>Sin pagos para mostrar</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>No hay pagos clasificados en Materia Prima con los filtros actuales.</div>
          </div>
        ) : vista === 'resumen' ? (
          <VistaResumen procesado={procesado} anio={anio} />
        ) : vista === 'proveedor' ? (
          <VistaProveedor procesado={procesado} expanded={expanded} toggleProveedor={toggleProveedor} />
        ) : (
          <VistaCronologia procesado={procesado} />
        )}
      </div>
    </div>
  )
}

function KPI({ label, valor, extra, icon, color, compact }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '10px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: 8, background: color + '15', color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10, color: '#6B7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
        <div style={{ fontSize: compact ? 12 : 16, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{valor}</div>
        {extra && <div style={{ fontSize: 10, color: '#6B7280', marginTop: 1 }}>{extra}</div>}
      </div>
    </div>
  )
}

function VistaResumen({ procesado, anio }) {
  const top15 = procesado.proveedores.slice(0, 15)
  const maxMonto = top15[0]?.total ?? 1
  return (
    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Distribución por cuenta madre</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {procesado.cuentasMadreData.map(c => {
            const pct = procesado.totalGeneral ? (c.total / procesado.totalGeneral) * 100 : 0
            return (
              <div key={c.nombre} style={{ flex: '1 1 200px', minWidth: 200, padding: '10px 12px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>{c.nombre}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>{fmtCLP(c.total)}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>{pct.toFixed(1)}%</span>
                </div>
                <div style={{ marginTop: 6, height: 4, background: '#E2E8F0', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: PRIMARY, borderRadius: 99 }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Top 15 proveedores · {anio}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {top15.map((p, i) => {
            const pct = procesado.totalGeneral ? (p.total / procesado.totalGeneral) * 100 : 0
            const barWidth = (p.total / maxMonto) * 100
            return (
              <div key={p.proveedor} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '4px 0' }}>
                <div style={{ width: 22, fontSize: 10, color: '#9CA3AF', fontWeight: 700, textAlign: 'right', flexShrink: 0 }}>#{i + 1}</div>
                <div style={{ width: 220, fontSize: 11, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }} title={p.proveedor}>
                  {p.proveedor}
                </div>
                <div style={{ flex: 1, height: 18, background: '#F1F5F9', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${barWidth}%`, background: `linear-gradient(to right, ${PRIMARY}, #3B82F6)`, borderRadius: 4 }} />
                </div>
                <div style={{ width: 110, fontSize: 11, fontWeight: 700, color: '#0F172A', textAlign: 'right', fontFamily: 'monospace', flexShrink: 0 }}>{fmtCLP(p.total)}</div>
                <div style={{ width: 50, fontSize: 10, color: '#64748B', textAlign: 'right', flexShrink: 0 }}>{pct.toFixed(1)}%</div>
                <div style={{ width: 40, fontSize: 10, color: '#9CA3AF', textAlign: 'right', flexShrink: 0 }}>{p.pagos.length} pag</div>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Pagos mensuales (top 10 proveedores)</div>
        <div style={{ overflow: 'auto', maxHeight: 360, border: '1px solid #F1F5F9', borderRadius: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 900 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
              <tr>
                <th style={{ ...TH, minWidth: 200 }}>Proveedor</th>
                {MESES_CORTOS.map(m => <th key={m} style={{ ...TH, textAlign: 'right', minWidth: 70 }}>{m}</th>)}
                <th style={{ ...TH, textAlign: 'right', background: '#E0F2FE', color: '#0369A1', minWidth: 90 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {procesado.proveedores.slice(0, 10).map(p => (
                <tr key={p.proveedor}>
                  <td style={{ ...TD, fontWeight: 600, color: '#111827' }} title={p.proveedor}>{p.proveedor.length > 28 ? p.proveedor.slice(0, 26) + '…' : p.proveedor}</td>
                  {p.mesesMonto.slice(1).map((v, i) => (
                    <td key={i} style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', color: v ? '#374151' : '#D1D5DB' }}>{fmtCLP(v)}</td>
                  ))}
                  <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#DC2626', background: '#F0F9FF' }}>{fmtCLP(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function VistaProveedor({ procesado, expanded, toggleProveedor }) {
  return (
    <div style={{ padding: '8px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...TH, width: 26 }}></th>
            <th style={TH}>Proveedor</th>
            <th style={{ ...TH, textAlign: 'right' }}>Total pagado</th>
            <th style={{ ...TH, textAlign: 'center' }}># Pagos</th>
            <th style={{ ...TH, textAlign: 'right' }}>% del total</th>
            <th style={TH}>Primer pago</th>
            <th style={TH}>Último pago</th>
            <th style={TH}>Subcuentas</th>
          </tr>
        </thead>
        <tbody>
          {procesado.proveedores.map(p => {
            const isOpen = expanded.has(p.proveedor)
            const pct = procesado.totalGeneral ? (p.total / procesado.totalGeneral) * 100 : 0
            return (
              <FilaProveedor key={p.proveedor} p={p} isOpen={isOpen} pct={pct} toggleProveedor={toggleProveedor} />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FilaProveedor({ p, isOpen, pct, toggleProveedor }) {
  return (
    <>
      <tr onClick={() => toggleProveedor(p.proveedor)}
        style={{ cursor: 'pointer', background: isOpen ? '#EFF6FF' : 'transparent' }}
        onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = '#F8FAFC' }}
        onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = 'transparent' }}>
        <td style={{ ...TD, textAlign: 'center' }}>{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
        <td style={{ ...TD, fontWeight: 600, color: '#111827' }}>{p.proveedor}</td>
        <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#DC2626' }}>{fmtCLP(p.total)}</td>
        <td style={{ ...TD, textAlign: 'center' }}>{p.pagos.length}</td>
        <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{pct.toFixed(1)}%</td>
        <td style={TD}>{fmtFecha(p.primer_pago)}</td>
        <td style={TD}>{fmtFecha(p.ultimo_pago)}</td>
        <td style={{ ...TD, fontSize: 10, color: '#6B7280' }}>
          {Array.from(p.subcuentas.keys()).slice(0, 2).join(' · ')}
          {p.subcuentas.size > 2 ? ` +${p.subcuentas.size - 2}` : ''}
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={8} style={{ background: '#F8FAFC', padding: '10px 18px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
              Detalle de los {p.pagos.length} pagos
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, background: '#fff', borderRadius: 6 }}>
              <thead>
                <tr>
                  <th style={{ ...TH, padding: '5px 8px', fontSize: 9 }}>Fecha</th>
                  <th style={{ ...TH, padding: '5px 8px', fontSize: 9 }}>Subcuenta</th>
                  <th style={{ ...TH, padding: '5px 8px', fontSize: 9 }}>Descripción</th>
                  <th style={{ ...TH, padding: '5px 8px', fontSize: 9, textAlign: 'right' }}>Monto</th>
                </tr>
              </thead>
              <tbody>
                {[...p.pagos].sort((a, b) => b.fecha.localeCompare(a.fecha)).map(pago => (
                  <tr key={pago.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                    <td style={{ ...TD, padding: '4px 8px', fontSize: 11 }}>{fmtFecha(pago.fecha)}</td>
                    <td style={{ ...TD, padding: '4px 8px', fontSize: 11, color: '#6B7280' }}>{pago.subcuenta_nombre}</td>
                    <td style={{ ...TD, padding: '4px 8px', fontSize: 11, color: '#6B7280', whiteSpace: 'normal' }}>{pago.descripcion}</td>
                    <td style={{ ...TD, padding: '4px 8px', fontSize: 11, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#DC2626' }}>{fmtCLP(pago.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  )
}

function VistaCronologia({ procesado }) {
  const movsOrdenados = [...procesado.movs].sort((a, b) => b.fecha.localeCompare(a.fecha))
  return (
    <div style={{ padding: '8px 0', maxHeight: '70vh', overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
          <tr>
            <th style={TH}>Fecha</th>
            <th style={TH}>Proveedor</th>
            <th style={TH}>Subcuenta</th>
            <th style={TH}>Cuenta madre</th>
            <th style={{ ...TH, textAlign: 'right' }}>Monto</th>
            <th style={TH}>Descripción original</th>
          </tr>
        </thead>
        <tbody>
          {movsOrdenados.map(m => (
            <tr key={m.id} style={{ borderTop: '1px solid #F1F5F9' }}
              onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <td style={TD}>{fmtFecha(m.fecha)}</td>
              <td style={{ ...TD, fontWeight: 600 }}>{m.proveedor}</td>
              <td style={{ ...TD, fontSize: 10, color: '#6B7280' }}>{m.subcuenta_nombre}</td>
              <td style={{ ...TD, fontSize: 10, color: '#9CA3AF' }}>{m.cuenta_madre_nombre}</td>
              <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#DC2626' }}>{fmtCLP(m.monto)}</td>
              <td style={{ ...TD, fontSize: 10, color: '#9CA3AF', whiteSpace: 'normal' }}>{m.descripcion}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
