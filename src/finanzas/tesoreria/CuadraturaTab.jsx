import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Download, Loader2, ChevronDown, ChevronUp, Info } from 'lucide-react'
import { formatCLP, cardSt, selectSt, labelSt, btnOutlineSt, TH, TD, estadoBadge } from './types'
import { fetchCierres, fetchKpisMes, fetchSucursales, fetchCuadraturasMes } from './api'

const PUEDE_TODO = ['admin', 'contabilidad', 'jefe_admin_finanzas', 'gerente_admin_finanzas', 'gerencia', 'admin_sistema']
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const fmt = n => formatCLP(n ?? 0)

function KpiCard({ title, value, color, sub }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9CA3AF', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? '#111827' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

const MEDIOS_DESGLOSE = [
  { key: 'efectivo',      label: 'Efectivo',           color: '#16A34A' },
  { key: 't_credito',     label: 'Crédito (Getnet)',   color: '#7C3AED' },
  { key: 't_debito',      label: 'Débito (Getnet)',    color: '#2563EB' },
  { key: 'webpay',        label: 'Webpay',             color: '#0891B2' },
  { key: 'transferencia', label: 'Transferencia',      color: '#D97706' },
  { key: 'm_pago',        label: 'Mercado Pago',       color: '#059669' },
  { key: 'abono_cliente', label: 'Abono cliente',      color: '#9CA3AF' },
  { key: 'canje',         label: 'Canje',              color: '#9CA3AF' },
  { key: 'p_clay',        label: 'Puntos Clay',        color: '#9CA3AF' },
  { key: 'cheque',        label: 'Cheque',             color: '#9CA3AF' },
]

function PanelMediosPago({ cierres }) {
  const [open, setOpen] = useState(false)

  // Acumular declarado y corroborado por medio, solo cierres con algún dato
  const totales = useMemo(() => {
    return MEDIOS_DESGLOSE.map(med => {
      const decl   = cierres.reduce((s, c) => s + Number(c[med.key]                ?? 0), 0)
      const corrob = cierres.reduce((s, c) => s + Number(c[`${med.key}_corrob`]    ?? 0), 0)
      const diff   = corrob - decl
      const tieneData = decl > 0 || corrob > 0
      return { ...med, decl, corrob, diff, tieneData }
    }).filter(m => m.tieneData)
  }, [cierres])

  const totalDecl   = totales.reduce((s, m) => s + m.decl, 0)
  const totalCorrob = totales.reduce((s, m) => s + m.corrob, 0)
  const totalDiff   = totalCorrob - totalDecl

  if (!totales.length) return null

  return (
    <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer',
          borderBottom: open ? '1px solid #F3F4F6' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Desglose por medio de pago</span>
          <span style={{ fontSize: 11, color: '#6B7280', background: '#F3F4F6', padding: '2px 8px', borderRadius: 10 }}>
            Declarado vs Corroborado · acumulado mes
          </span>
        </div>
        {open ? <ChevronUp size={16} color="#6B7280" /> : <ChevronDown size={16} color="#6B7280" />}
      </button>

      {open && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                <th style={{ ...TH, textAlign: 'left', width: 160 }}>Medio</th>
                <th style={{ ...TH, textAlign: 'right' }}>Declarado</th>
                <th style={{ ...TH, textAlign: 'right' }}>Corroborado</th>
                <th style={{ ...TH, textAlign: 'right' }}>Diferencia</th>
                <th style={{ ...TH, textAlign: 'left', width: 200 }}>Barra</th>
              </tr>
            </thead>
            <tbody>
              {totales.map(m => {
                const diffColor = m.diff === 0 ? '#16A34A' : Math.abs(m.diff) < 20000 ? '#D97706' : '#DC2626'
                // Barra comparativa: declarado = base, corroborado = overlay
                const maxVal = Math.max(m.decl, m.corrob, 1)
                const pctDecl   = (m.decl   / maxVal) * 100
                const pctCorrob = (m.corrob / maxVal) * 100
                return (
                  <tr key={m.key} style={{ borderTop: '1px solid #F3F4F6' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#F9FAFB'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ ...TD }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                        <span style={{ fontWeight: 500 }}>{m.label}</span>
                      </div>
                    </td>
                    <td style={{ ...TD, textAlign: 'right' }}>{fmt(m.decl)}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>{m.corrob === 0 && m.decl > 0 ? <span style={{ color: '#9CA3AF' }}>Pend.</span> : fmt(m.corrob)}</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 600, color: diffColor }}>
                      {m.corrob === 0 && m.decl > 0 ? '—' : `${m.diff >= 0 ? '+' : ''}${fmt(m.diff)}`}
                    </td>
                    <td style={{ ...TD }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {/* Barra declarado */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ fontSize: 9, color: '#9CA3AF', width: 16, textAlign: 'right' }}>D</div>
                          <div style={{ flex: 1, height: 6, background: '#F3F4F6', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${pctDecl}%`, height: '100%', background: m.color, opacity: 0.5, borderRadius: 3 }} />
                          </div>
                        </div>
                        {/* Barra corroborado */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ fontSize: 9, color: '#9CA3AF', width: 16, textAlign: 'right' }}>C</div>
                          <div style={{ flex: 1, height: 6, background: '#F3F4F6', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${pctCorrob}%`, height: '100%', background: m.color, borderRadius: 3 }} />
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {/* Fila totales */}
              <tr style={{ borderTop: '2px solid #E5E7EB', background: '#F9FAFB' }}>
                <td style={{ ...TD, fontWeight: 700 }}>TOTAL</td>
                <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{fmt(totalDecl)}</td>
                <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{fmt(totalCorrob)}</td>
                <td style={{ ...TD, textAlign: 'right', fontWeight: 700,
                  color: totalDiff === 0 ? '#16A34A' : Math.abs(totalDiff) < 50000 ? '#D97706' : '#DC2626' }}>
                  {totalDiff >= 0 ? '+' : ''}{fmt(totalDiff)}
                </td>
                <td style={TD} />
              </tr>
            </tbody>
          </table>
          <div style={{ padding: '10px 16px', borderTop: '1px solid #F3F4F6', fontSize: 11, color: '#9CA3AF' }}>
            D = Declarado por vendedor · C = Corroborado por admin · "Pend." = cierres declarados pero no corroborados aún
          </div>
        </div>
      )}
    </div>
  )
}

function PanelCxcMes({ cuad, loading }) {
  const [open, setOpen] = useState(false)
  if (loading || !cuad) return null
  const venta      = Number(cuad.venta_facturada  ?? 0)
  const caja       = Number(cuad.caja_declarada   ?? 0)
  const abonosRec  = Number(cuad.abonos_recibidos ?? 0)
  const ventasImp  = Number(cuad.ventas_imputadas ?? 0)
  const deltaCxc   = Number(cuad.delta_cxc        ?? 0)
  const brechaReal = Number(cuad.brecha_real       ?? 0)
  return (
    <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer',
          borderBottom: open ? '1px solid #F3F4F6' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Cuadratura Venta vs Caja</span>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
            background: cuad.cuadra_contable ? '#DCFCE7' : '#FEF3C7',
            color:      cuad.cuadra_contable ? '#16A34A' : '#D97706' }}>
            {cuad.cuadra_contable ? '✓ Cuadra contablemente' : '⚠ Brecha real pendiente'}
          </span>
        </div>
        {open ? <ChevronUp size={16} color="#6B7280" /> : <ChevronDown size={16} color="#6B7280" />}
      </button>
      {open && (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Identidad contable del mes</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', gap: 8, alignItems: 'center', textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#1F4E79' }}>{fmt(venta)}</div>
                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>Venta facturada</div>
              </div>
              <div style={{ fontSize: 18, color: '#9CA3AF' }}>=</div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#16A34A' }}>{fmt(caja)}</div>
                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>Caja declarada</div>
              </div>
              <div style={{ fontSize: 18, color: '#9CA3AF' }}>+</div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: Math.abs(deltaCxc) < 1000 ? '#374151' : '#D97706' }}>
                  {deltaCxc >= 0 ? '+' : ''}{fmt(deltaCxc)}
                </div>
                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>Δ CxC</div>
              </div>
            </div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#6B7280' }}>Brecha real (debería ser ~0)</span>
              <span style={{ fontWeight: 700, fontSize: 14, color: Math.abs(brechaReal) < 1000 ? '#16A34A' : Math.abs(brechaReal) < 50000 ? '#D97706' : '#DC2626' }}>
                {brechaReal >= 0 ? '+' : ''}{fmt(brechaReal)}{Math.abs(brechaReal) < 1000 ? ' ✓' : ''}
              </span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ background: '#EFF6FF', borderRadius: 8, padding: '12px 14px', border: '1px solid #BFDBFE' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#1E40AF', textTransform: 'uppercase', marginBottom: 6 }}>Abonos recibidos</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#1E40AF' }}>{fmt(abonosRec)}</div>
              <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>{cuad.n_abonos ?? 0} comprobante{(cuad.n_abonos??0) !== 1 ? 's' : ''} · entró a caja, no es venta</div>
            </div>
            <div style={{ background: '#FFF7ED', borderRadius: 8, padding: '12px 14px', border: '1px solid #FED7AA' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#C2410C', textTransform: 'uppercase', marginBottom: 6 }}>Ventas imputadas</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#C2410C' }}>{fmt(ventasImp)}</div>
              <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4 }}>{cuad.n_ventas_imputadas ?? 0} venta{(cuad.n_ventas_imputadas??0) !== 1 ? 's' : ''} · venta sin caja física</div>
            </div>
          </div>
          <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#6B7280', display: 'flex', gap: 8 }}>
            <Info size={14} style={{ flexShrink: 0, marginTop: 1, color: '#9CA3AF' }} />
            <span>
              <strong>Δ CxC = {fmt(abonosRec)} − {fmt(ventasImp)} = {deltaCxc >= 0 ? '+' : ''}{fmt(deltaCxc)}.</strong>{' '}
              {deltaCxc > 0 ? 'Los clientes abonaron más de lo que compraron. Saldo CxC aumentó.' : deltaCxc < 0 ? 'Los clientes compraron más de lo que abonaron. Saldo CxC bajó.' : 'Abonos y ventas compensados.'}
              {' '}Ver saldo acumulado en la pestaña "CxC".
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export function CuadraturaTab({ usuario }) {
  const now = new Date()
  const [anio, setAnio]     = useState(now.getFullYear())
  const [mes, setMes]       = useState(now.getMonth() + 1)
  const puedeElegirSuc      = PUEDE_TODO.includes(usuario.rol)
  const [sucursales, setSucursales] = useState([])
  const [sucursal, setSucursal]     = useState(puedeElegirSuc ? 'all' : (usuario.sucursal_id ?? ''))
  const [cierres, setCierres]       = useState([])
  const [kpis, setKpis]             = useState(null)
  const [cuadratura, setCuadratura] = useState(null)
  const [loadingCierres, setLoadingCierres] = useState(true)
  const [loadingKpis, setLoadingKpis]       = useState(true)
  const [loadingCuad, setLoadingCuad]       = useState(false)

  const sucursalEf = sucursal === 'all' ? null : sucursal || null
  const desde = `${anio}-${String(mes).padStart(2,'0')}-01`
  const fin   = new Date(anio, mes, 0)
  const hasta = `${anio}-${String(mes).padStart(2,'0')}-${String(fin.getDate()).padStart(2,'0')}`
  const anios = [now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1]

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
  useEffect(() => {
    setLoadingCuad(true)
    fetchCuadraturasMes({ anio, mes, sucursal_id: sucursalEf })
      .then(rows => {
        if (!rows.length) { setCuadratura(null); return }
        const agg = rows.reduce((acc, r) => ({
          venta_facturada:    (acc.venta_facturada??0)    + Number(r.venta_facturada??0),
          caja_declarada:     (acc.caja_declarada??0)     + Number(r.caja_declarada??0),
          caja_corroborada:   (acc.caja_corroborada??0)   + Number(r.caja_corroborada??0),
          delta_cxc:          (acc.delta_cxc??0)          + Number(r.delta_cxc??0),
          abonos_recibidos:   (acc.abonos_recibidos??0)   + Number(r.abonos_recibidos??0),
          ventas_imputadas:   (acc.ventas_imputadas??0)   + Number(r.ventas_imputadas??0),
          brecha_real:        (acc.brecha_real??0)        + Number(r.brecha_real??0),
          n_abonos:           (acc.n_abonos??0)           + Number(r.n_abonos??0),
          n_ventas_imputadas: (acc.n_ventas_imputadas??0) + Number(r.n_ventas_imputadas??0),
          n_cierres:          (acc.n_cierres??0)          + Number(r.n_cierres??0),
          n_descuadre:        (acc.n_descuadre??0)        + Number(r.n_descuadre??0),
        }), {})
        agg.cuadra_contable = Math.abs(agg.brecha_real) < 1000
        setCuadratura(agg)
      })
      .catch(() => setCuadratura(null))
      .finally(() => setLoadingCuad(false))
  }, [anio, mes, sucursalEf])

  function exportarCSV() {
    const h = ['fecha','sucursal','vendedor','bsale_api','declarado','brecha_bsale','corroborado','diferencia','estado']
    const r = cierres.map(c => [c.fecha,c.sucursal_nombre??'',c.vendedor_nombre??'',c.venta_bsale_api??'',c.total_declarado??'',c.brecha_bsale??'',c.total_corroborado??'',c.diferencia??'',c.estado])
    const csv = [h,...r].map(row => row.map(v => { const s=String(v??''); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s }).join(',')).join('\n')
    const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([csv],{type:'text/csv'})),download:`cuadratura_${anio}-${String(mes).padStart(2,'0')}.csv`})
    a.click()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={cardSt}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, alignItems: 'flex-end' }}>
          <div><label style={labelSt}>Año</label>
            <select style={selectSt} value={String(anio)} onChange={e => setAnio(Number(e.target.value))}>
              {anios.map(a => <option key={a} value={String(a)}>{a}</option>)}
            </select></div>
          <div><label style={labelSt}>Mes</label>
            <select style={selectSt} value={String(mes)} onChange={e => setMes(Number(e.target.value))}>
              {MESES.map((m,i) => <option key={i+1} value={String(i+1)}>{m}</option>)}
            </select></div>
          <div><label style={labelSt}>Sucursal</label>
            <select style={selectSt} value={sucursal} disabled={!puedeElegirSuc} onChange={e => setSucursal(e.target.value)}>
              {puedeElegirSuc && <option value="all">Todas</option>}
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select></div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button onClick={exportarCSV} disabled={!cierres.length} style={{ ...btnOutlineSt, width: '100%', justifyContent: 'center', opacity: cierres.length ? 1 : 0.5 }}>
              <Download size={13} /> CSV
            </button></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <KpiCard title="Ventas BSALE mes"     value={loadingKpis ? '…' : fmt(kpis?.ventasBsale)} color="#1F4E79" />
        <KpiCard title="Caja declarada"        value={loadingCuad ? '…' : fmt(cuadratura?.caja_declarada)} color="#16A34A" />
        <KpiCard title="Abonos recibidos"      value={loadingCuad ? '…' : fmt(cuadratura?.abonos_recibidos)} color="#1E40AF" sub="entraron a caja, no son venta" />
        <KpiCard title="Ventas imputadas"      value={loadingCuad ? '…' : fmt(cuadratura?.ventas_imputadas)} color="#C2410C" sub="ventas sin caja física" />
        <KpiCard title="Pend. corroborar"      value={loadingKpis ? '…' : String(kpis?.pendientes ?? 0)} color="#D97706" />
        <KpiCard title="Descuadres"            value={loadingKpis ? '…' : String(kpis?.descuadres ?? 0)} color={(kpis?.descuadres??0)>0 ? '#DC2626' : '#111827'} />
      </div>

      <PanelCxcMes cuad={cuadratura} loading={loadingCuad} />

      <PanelMediosPago cierres={cierres} />

      <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #F3F4F6', fontSize: 14, fontWeight: 600 }}>
          Detalle del mes — {MESES[mes-1]} {anio}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {['Fecha','Sucursal','Vendedor','Venta BSALE','Caja física','Brecha','Corroborado','Diferencia','Estado'].map(h => (
                <th key={h} style={{ ...TH, textAlign: ['Venta BSALE','Caja física','Brecha','Corroborado','Diferencia'].includes(h) ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {loadingCierres && <tr><td colSpan={9} style={{ ...TD, textAlign: 'center', padding: '40px 0' }}><Loader2 size={20} style={{ display:'inline-block',color:'#9CA3AF' }} /></td></tr>}
              {!loadingCierres && !cierres.length && <tr><td colSpan={9} style={{ ...TD, textAlign: 'center', padding: '40px 0', color: '#9CA3AF' }}>Sin cierres en este filtro</td></tr>}
              {!loadingCierres && cierres.map(c => {
                const difColor = c.diferencia == null ? '#374151' : Math.abs(Number(c.diferencia))===0 ? '#16A34A' : '#DC2626'
                const abCli = Number(c.abono_cliente ?? 0)
                const cajaFisica = c.venta_bsale_api != null ? Number(c.venta_bsale_api) - abCli : null
                return (
                  <tr key={c.id} style={{ borderTop: '1px solid #F3F4F6' }}
                    onMouseEnter={e => e.currentTarget.style.background='#F9FAFB'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    <td style={TD}>{c.fecha}</td>
                    <td style={TD}>{c.sucursal_nombre ?? '—'}</td>
                    <td style={TD}>{c.vendedor_nombre ?? '—'}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>{c.venta_bsale_api==null ? '—' : fmt(c.venta_bsale_api)}</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>
                      {cajaFisica==null ? '—' : fmt(cajaFisica)}
                      {abCli > 0 && <span title={`${fmt(abCli)} de abono cliente — no entra a caja`}
                        style={{ marginLeft: 4, fontSize: 9, color: '#C2410C', background: '#FFF7ED', padding: '1px 4px', borderRadius: 3 }}>AC</span>}
                    </td>
                    <td style={{ ...TD, textAlign: 'right' }}>{fmt(c.brecha_bsale)}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>{c.total_corroborado==null ? '—' : fmt(c.total_corroborado)}</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 600, color: difColor }}>{c.diferencia==null ? '—' : fmt(c.diferencia)}</td>
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
