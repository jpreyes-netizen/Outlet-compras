import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../supabase'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt     = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
const to_f    = v => { try { return v == null ? 0 : Number(v) } catch { return 0 } }

// ── Paleta ────────────────────────────────────────────────────────────────────
const AZUL    = '#1F4E79'
const VERDE   = '#16A34A'
const ROJO    = '#DC2626'
const NARANJA = '#D97706'
const GRIS    = '#6B7280'

const EST = {
  cuadra:    { l: '✅ Cuadra',    c: VERDE,   bg: '#DCFCE7' },
  tolerable: { l: '⚠️ Tolerable', c: NARANJA, bg: '#FEF3C7' },
  descuadre: { l: '🔴 Descuadre', c: ROJO,    bg: '#FEE2E2' },
  pendiente: { l: '⏳ Pendiente', c: GRIS,    bg: '#F3F4F6' },
}

const MEDIOS_INFO = {
  efectivo:       { l: 'Efectivo',          ic: '💵', fuente: 'Comprobante depósito bancario',   color: VERDE   },
  tarjetas_getnet:{ l: 'Tarjetas (Getnet)', ic: '💳', fuente: 'Liquidación Getnet',              color: AZUL    },
  webpay:         { l: 'Webpay',            ic: '🌐', fuente: 'Movimientos bancarios Transbank', color: '#7C3AED'},
  transferencia:  { l: 'Transferencia',     ic: '🏦', fuente: 'Cartola bancaria',                color: '#0891B2'},
  mercadopago:    { l: 'Mercado Pago',      ic: '📱', fuente: 'Liquidación MP (manual)',         color: '#059669'},
  otros:          { l: 'Otros medios',      ic: '📋', fuente: 'Comprobante físico adjunto',      color: GRIS    },
}

// ── Semáforo KPI ──────────────────────────────────────────────────────────────
function Semaforo({ ic, label, corrob, externo, fuente, estado, dif }) {
  const e = EST[estado] || EST.pendiente
  return (
    <div style={{
      background: '#fff', borderRadius: 14, padding: '18px 22px',
      boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
      borderLeft: `4px solid ${e.c}`,
      display: 'flex', flexDirection: 'column', gap: 6
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1C1C1E', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span>{ic}</span>{label}
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 100, color: e.c, background: e.bg }}>
          {e.l}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 4 }}>
        <div>
          <div style={{ fontSize: 10, color: GRIS, marginBottom: 2 }}>Corroborado</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: AZUL }}>{fmt(corrob)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: GRIS, marginBottom: 2 }}>Externo ({fuente.split(' ')[0]})</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#374151' }}>{fmt(externo)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: GRIS, marginBottom: 2 }}>Diferencia</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: Math.abs(dif) > 50000 ? ROJO : (Math.abs(dif) > 5000 ? NARANJA : VERDE) }}>
            {dif >= 0 ? '+' : ''}{fmt(dif)}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 10, color: GRIS, marginTop: 2 }}>Fuente: {fuente}</div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
export function ConciliacionMediosTab({ usuario }) {
  const [valids,     setValids]     = useState([])
  const [depositos,  setDepositos]  = useState([])
  const [getnet,     setGetnet]     = useState([])
  const [sucursales, setSucursales] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)

  // Filtros
  const hoy  = new Date()
  const mesD = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  const [filMes,  setFilMes]  = useState(mesD)
  const [filSuc,  setFilSuc]  = useState('todas')
  const [filMed,  setFilMed]  = useState('todos')
  const [filEst,  setFilEst]  = useState('todos')
  const [expand,  setExpand]  = useState(null) // fila expandida

  useEffect(() => {
    async function cargar() {
      setLoading(true); setError(null)
      try {
        const [
          { data: vs, error: e1 },
          { data: ds, error: e2 },
          { data: gs, error: e3 },
          { data: ss, error: e4 },
        ] = await Promise.all([
          supabase.from('validaciones_medio_pago').select('*').order('fecha', { ascending: false }),
          supabase.from('depositos_efectivo').select('*').order('fecha', { ascending: false }),
          supabase.from('abonos_getnet').select('*').order('fecha', { ascending: false }),
          supabase.from('sucursales').select('id, nombre').eq('activo', true).order('orden'),
        ])
        if (e1) throw e1; if (e2) throw e2; if (e3) throw e3; if (e4) throw e4
        setValids(vs || []); setDepositos(ds || [])
        setGetnet(gs || []); setSucursales(ss || [])
      } catch(e) { setError(e.message) }
      finally { setLoading(false) }
    }
    cargar()
  }, [])

  const mesesDisp = useMemo(() => {
    const set = new Set([...valids, ...depositos, ...getnet].map(r => r.fecha?.slice(0,7)).filter(Boolean))
    return [...set].sort().reverse()
  }, [valids, depositos, getnet])

  const getNombreSuc = id => sucursales.find(s => s.id === id)?.nombre || id || '—'

  // Filtrar validaciones
  const valFilt = useMemo(() => valids.filter(v => {
    const enMes = filMes ? v.fecha?.startsWith(filMes) : true
    const enSuc = filSuc !== 'todas' ? v.sucursal_id === filSuc : true
    const enMed = filMed !== 'todos' ? v.medio_pago === filMed : true
    const enEst = filEst !== 'todos' ? v.estado === filEst : true
    return enMes && enSuc && enMed && enEst
  }), [valids, filMes, filSuc, filMed, filEst])

  // KPIs semáforos — período completo filtrado por mes/sucursal
  const kpis = useMemo(() => {
    const base = valids.filter(v => {
      const enMes = filMes ? v.fecha?.startsWith(filMes) : true
      const enSuc = filSuc !== 'todas' ? v.sucursal_id === filSuc : true
      return enMes && enSuc
    })

    const ef  = base.filter(v => v.medio_pago === 'efectivo')
    const gn  = base.filter(v => v.medio_pago === 'tarjetas_getnet')
    const wp  = base.filter(v => v.medio_pago === 'webpay')
    const tr  = base.filter(v => v.medio_pago === 'transferencia')

    const sum = (arr, col) => arr.reduce((s, r) => s + to_f(r[col]), 0)
    const estAgg = arr => {
      const dif = sum(arr, 'monto_externo') - sum(arr, 'monto_corroborado')
      if (!arr.length) return 'pendiente'
      const dabs = Math.abs(dif)
      if (dabs <= 2000) return 'cuadra'
      if (dabs <= 50000) return 'tolerable'
      return 'descuadre'
    }

    // Depósitos efectivo del período
    const depFilt = depositos.filter(d => {
      const enMes = filMes ? d.fecha?.startsWith(filMes) : true
      const enSuc = filSuc !== 'todas' ? d.sucursal_id === filSuc : true
      return enMes && enSuc
    })
    const gnFilt = getnet.filter(g => {
      const enMes = filMes ? g.fecha?.startsWith(filMes) : true
      const enSuc = filSuc !== 'todas' ? g.sucursal_id === filSuc : true
      return enMes && enSuc
    })

    const ef_corrob = sum(ef, 'monto_corroborado')
    const dep_total = depFilt.reduce((s,d) => s + to_f(d.monto_depositado), 0)
    const dif_ef    = dep_total - ef_corrob

    const tarj_corrob = sum(gn, 'monto_corroborado')
    const gn_total    = gnFilt.reduce((s,g) => s + to_f(g.total_abono_getnet), 0)
    const dif_gn      = gn_total - tarj_corrob

    const wp_corrob = sum(wp, 'monto_corroborado')
    const wp_ext    = sum(wp, 'monto_externo')
    const tr_corrob = sum(tr, 'monto_corroborado')
    const tr_ext    = sum(tr, 'monto_externo')

    return {
      efectivo: { corrob: ef_corrob, ext: dep_total, dif: dif_ef, est: estAgg([{monto_corroborado: ef_corrob, monto_externo: dep_total}]) },
      getnet:   { corrob: tarj_corrob, ext: gn_total, dif: dif_gn, est: estAgg([{monto_corroborado: tarj_corrob, monto_externo: gn_total}]) },
      webpay:   { corrob: wp_corrob, ext: wp_ext, dif: wp_ext - wp_corrob, est: estAgg(wp) },
      transf:   { corrob: tr_corrob, ext: tr_ext, dif: tr_ext - tr_corrob, est: estAgg(tr) },
    }
  }, [valids, depositos, getnet, filMes, filSuc])

  // ── Estilos ──────────────────────────────────────────────────────────────────
  const cardSt = { background: '#fff', borderRadius: 12, padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: 16 }
  const TH = { padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: GRIS, letterSpacing: '0.05em', textTransform: 'uppercase', background: '#F9FAFB', whiteSpace: 'nowrap' }
  const TD = { padding: '9px 12px', fontSize: 12, color: '#374151', whiteSpace: 'nowrap', verticalAlign: 'middle' }
  const selSt = { padding: '7px 12px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13, color: '#374151', background: '#fff', cursor: 'pointer' }

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: GRIS, fontSize: 13 }}>Cargando conciliación...</div>
  if (error)   return <div style={{ textAlign: 'center', padding: 60, color: ROJO,  fontSize: 13 }}>Error: {error}</div>

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif" }}>

      {/* ── Título + Filtros ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: AZUL }}>🔀 Conciliación Medios de Pago</div>

        <select value={filMes} onChange={e => setFilMes(e.target.value)} style={selSt}>
          <option value="">Todos los meses</option>
          {mesesDisp.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <select value={filSuc} onChange={e => setFilSuc(e.target.value)} style={selSt}>
          <option value="todas">Todas las sucursales</option>
          {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>

        <select value={filMed} onChange={e => setFilMed(e.target.value)} style={selSt}>
          <option value="todos">Todos los medios</option>
          {Object.entries(MEDIOS_INFO).map(([k, v]) => <option key={k} value={k}>{v.ic} {v.l}</option>)}
        </select>

        <select value={filEst} onChange={e => setFilEst(e.target.value)} style={selSt}>
          <option value="todos">Todos los estados</option>
          {Object.entries(EST).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
        </select>

        <div style={{ marginLeft: 'auto', fontSize: 12, color: GRIS }}>
          {valFilt.length} validaciones
        </div>
      </div>

      {/* ── Semáforos ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 16 }}>
        <Semaforo
          ic="💵" label="Efectivo"
          corrob={kpis.efectivo.corrob} externo={kpis.efectivo.ext}
          dif={kpis.efectivo.dif} estado={kpis.efectivo.est}
          fuente="Comprobante depósito bancario"
        />
        <Semaforo
          ic="💳" label="Tarjetas Getnet (C+D)"
          corrob={kpis.getnet.corrob} externo={kpis.getnet.ext}
          dif={kpis.getnet.dif} estado={kpis.getnet.est}
          fuente="Liquidación Getnet"
        />
        <Semaforo
          ic="🌐" label="Webpay"
          corrob={kpis.webpay.corrob} externo={kpis.webpay.ext}
          dif={kpis.webpay.dif} estado={kpis.webpay.est}
          fuente="Movimientos bancarios"
        />
        <Semaforo
          ic="🏦" label="Transferencias"
          corrob={kpis.transf.corrob} externo={kpis.transf.ext}
          dif={kpis.transf.dif} estado={kpis.transf.est}
          fuente="Cartola bancaria"
        />
      </div>

      {/* ── Leyenda lógica de validación ── */}
      <div style={{ ...cardSt, padding: '12px 20px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: AZUL, marginBottom: 8 }}>📋 Lógica de validación por medio</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          {Object.entries(MEDIOS_INFO).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11 }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{v.ic}</span>
              <div>
                <div style={{ fontWeight: 700, color: v.color }}>{v.l}</div>
                <div style={{ color: GRIS, lineHeight: 1.4 }}>{v.fuente}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabla detalle ── */}
      <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #F3F4F6', fontSize: 13, fontWeight: 700, color: AZUL }}>
          Detalle de validaciones
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Fecha</th>
                <th style={TH}>Sucursal</th>
                <th style={TH}>Medio</th>
                <th style={{ ...TH, textAlign: 'right' }}>Corroborado</th>
                <th style={{ ...TH, textAlign: 'right' }}>Externo</th>
                <th style={{ ...TH, textAlign: 'right' }}>Diferencia</th>
                <th style={TH}>Fuente</th>
                <th style={TH}>Estado</th>
                <th style={TH}>Ref.</th>
              </tr>
            </thead>
            <tbody>
              {valFilt.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ ...TD, textAlign: 'center', padding: '32px 0', color: GRIS }}>
                    Sin validaciones para los filtros seleccionados
                  </td>
                </tr>
              ) : valFilt.map(v => {
                const mi    = MEDIOS_INFO[v.medio_pago] || MEDIOS_INFO.otros
                const est   = EST[v.estado] || EST.pendiente
                const dif   = to_f(v.diferencia)
                const difAbs = Math.abs(dif)
                const isExp = expand === v.id
                return [
                  <tr
                    key={v.id}
                    onClick={() => setExpand(isExp ? null : v.id)}
                    style={{ borderTop: '1px solid #F9FAFB', cursor: 'pointer', background: isExp ? '#F0F7FF' : 'transparent' }}
                  >
                    <td style={TD}>{v.fecha}</td>
                    <td style={TD}>{getNombreSuc(v.sucursal_id)}</td>
                    <td style={{ ...TD, fontWeight: 600, color: mi.color }}>
                      {mi.ic} {mi.l}
                    </td>
                    <td style={{ ...TD, textAlign: 'right' }}>{fmt(v.monto_corroborado)}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>{fmt(v.monto_externo)}</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: difAbs > 50000 ? ROJO : (difAbs > 5000 ? NARANJA : VERDE) }}>
                      {dif >= 0 ? '+' : ''}{fmt(dif)}
                    </td>
                    <td style={{ ...TD, color: GRIS }}>{v.fuente_externa || '—'}</td>
                    <td style={TD}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100, color: est.c, background: est.bg }}>
                        {est.l}
                      </span>
                    </td>
                    <td style={{ ...TD, color: GRIS }}>{v.referencia_externa || '—'}</td>
                  </tr>,
                  isExp && (
                    <tr key={v.id + '_exp'} style={{ background: '#F8FAFC' }}>
                      <td colSpan={9} style={{ padding: '12px 24px', fontSize: 12, borderTop: '1px solid #E5E7EB' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                          <div><span style={{ color: GRIS }}>Observaciones:</span><br /><span style={{ fontWeight: 600 }}>{v.observaciones || '—'}</span></div>
                          <div><span style={{ color: GRIS }}>Validado por:</span><br /><span style={{ fontWeight: 600 }}>{v.validado_por || 'No validado'}</span></div>
                          <div><span style={{ color: GRIS }}>Validado el:</span><br /><span style={{ fontWeight: 600 }}>{v.validado_at ? new Date(v.validado_at).toLocaleDateString('es-CL') : '—'}</span></div>
                          {v.comprobante_url && (
                            <div>
                              <a href={v.comprobante_url} target="_blank" rel="noreferrer"
                                style={{ color: AZUL, fontWeight: 600, fontSize: 12 }}>
                                📎 Ver comprobante
                              </a>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                ]
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Depósitos Efectivo ── */}
      <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #F3F4F6', fontSize: 13, fontWeight: 700, color: VERDE }}>
          💵 Depósitos Efectivo — Registro bancario
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Fecha</th>
                <th style={TH}>Sucursal</th>
                <th style={{ ...TH, textAlign: 'right' }}>Depositado</th>
                <th style={{ ...TH, textAlign: 'right' }}>No depositado</th>
                <th style={TH}>N° Comprobante</th>
                <th style={TH}>Estado</th>
                <th style={TH}>Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {depositos
                .filter(d => {
                  const enMes = filMes ? d.fecha?.startsWith(filMes) : true
                  const enSuc = filSuc !== 'todas' ? d.sucursal_id === filSuc : true
                  return enMes && enSuc
                })
                .slice(0, 50)
                .map(d => {
                  const est = EST[d.estado] || EST.pendiente
                  return (
                    <tr key={d.id} style={{ borderTop: '1px solid #F9FAFB' }}>
                      <td style={TD}>{d.fecha}</td>
                      <td style={TD}>{getNombreSuc(d.sucursal_id)}</td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 600, color: VERDE }}>{fmt(d.monto_depositado)}</td>
                      <td style={{ ...TD, textAlign: 'right', color: to_f(d.total_no_depositado) > 0 ? NARANJA : GRIS }}>
                        {fmt(d.total_no_depositado)}
                      </td>
                      <td style={{ ...TD, color: GRIS }}>{d.comprobante_nombre || '—'}</td>
                      <td style={TD}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100, color: est.c, background: est.bg }}>
                          {est.l}
                        </span>
                      </td>
                      <td style={{ ...TD, color: GRIS, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {d.observaciones || '—'}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Abonos Getnet ── */}
      <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #F3F4F6', fontSize: 13, fontWeight: 700, color: AZUL }}>
          💳 Abonos Getnet — Tarjetas procesadas
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Fecha</th>
                <th style={TH}>Sucursal</th>
                <th style={{ ...TH, textAlign: 'right' }}>Crédito corrob.</th>
                <th style={{ ...TH, textAlign: 'right' }}>Débito corrob.</th>
                <th style={{ ...TH, textAlign: 'right' }}>Total tarjetas</th>
                <th style={{ ...TH, textAlign: 'right' }}>Abono bruto</th>
                <th style={{ ...TH, textAlign: 'right' }}>Comisión</th>
                <th style={{ ...TH, textAlign: 'right' }}>Total abono</th>
                <th style={{ ...TH, textAlign: 'right' }}>Diferencia</th>
                <th style={TH}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {getnet
                .filter(g => {
                  const enMes = filMes ? g.fecha?.startsWith(filMes) : true
                  const enSuc = filSuc !== 'todas' ? g.sucursal_id === filSuc : true
                  return enMes && enSuc
                })
                .slice(0, 50)
                .map(g => {
                  const est   = EST[g.estado] || EST.pendiente
                  const dif   = to_f(g.diferencia)
                  const difAbs = Math.abs(dif)
                  return (
                    <tr key={g.id} style={{ borderTop: '1px solid #F9FAFB' }}>
                      <td style={TD}>{g.fecha}</td>
                      <td style={TD}>{getNombreSuc(g.sucursal_id)}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>{fmt(g.credito_corroborado)}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>{fmt(g.debito_corroborado)}</td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{fmt(g.total_tarjetas)}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>{fmt(g.abono_bruto)}</td>
                      <td style={{ ...TD, textAlign: 'right', color: NARANJA }}>{fmt(g.comision_getnet)}</td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{fmt(g.total_abono_getnet)}</td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: difAbs > 50000 ? ROJO : (difAbs > 5000 ? NARANJA : VERDE) }}>
                        {dif >= 0 ? '+' : ''}{fmt(dif)}
                      </td>
                      <td style={TD}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100, color: est.c, background: est.bg }}>
                          {est.l}
                        </span>
                      </td>
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
