import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  MEDIOS, UMBRALES_DEFAULT, formatCLP, parseCLP,
  isoDelta, inputSt, selectSt, labelSt, cardSt, btnSt, btnOutlineSt,
  TH, TD, estadoBadge, clasificarPorDiferencia,
} from './types'
import { fetchCierres, fetchSucursales, fetchUmbrales, corroborarCierre } from './api'

function MoneyInput({ value, onChange, disabled }) {
  const [text, setText] = useState(value ? formatCLP(value) : '')
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(value ? formatCLP(value) : '') }, [value, focused])
  return (
    <input type="text" inputMode="numeric" disabled={disabled} placeholder="$0" value={text}
      style={{ ...inputSt, textAlign: 'right', fontSize: 12, background: disabled ? '#F9FAFB' : '#fff' }}
      onFocus={e => { setFocused(true); setText(value ? String(value) : ''); setTimeout(() => e.target.select(), 0) }}
      onChange={e => { setText(e.target.value); onChange(parseCLP(e.target.value)) }}
      onBlur={() => { setFocused(false); setText(value ? formatCLP(value) : '') }}
    />
  )
}

function valoresCorrobInicial(c) {
  const v = {}
  for (const m of MEDIOS) {
    const decl = Number(c[m.key] ?? 0)
    const corrob = c[`${m.key}_corrob`]
    v[`${m.key}_corrob`] = Number(corrob ?? decl)
  }
  return v
}

const PUEDE_VER_TODAS = ['admin', 'contabilidad', 'jefe_admin_finanzas', 'gerente_admin_finanzas', 'admin_sistema']

export function CorroborarCierresTab({ usuario }) {
  const puedeElegirSuc = PUEDE_VER_TODAS.includes(usuario.rol)
  const [sucursales, setSucursales] = useState([])
  const [umbrales, setUmbrales] = useState(UMBRALES_DEFAULT)
  const [sucursalSel, setSucursalSel] = useState(puedeElegirSuc ? 'all' : (usuario.sucursal_id ?? ''))
  const [desde, setDesde] = useState(isoDelta(-14))
  const [hasta, setHasta] = useState(isoDelta(0))
  const [soloPendientes, setSoloPendientes] = useState(true)
  const [cierres, setCierres] = useState([])
  const [loading, setLoading] = useState(true)
  const [drawer, setDrawer] = useState(null)
  const [valoresCorrob, setValoresCorrob] = useState(null)
  const [obsAdmin, setObsAdmin] = useState('')
  const [saving, setSaving] = useState(false)

  const sucursalEf = sucursalSel === 'all' ? null : sucursalSel || null

  useEffect(() => {
    fetchSucursales().then(setSucursales).catch(() => {})
    fetchUmbrales().then(setUmbrales).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchCierres({
      sucursal_id: sucursalEf,
      fecha_desde: desde,
      fecha_hasta: hasta,
      estados: soloPendientes ? ['declarado'] : null,
    }).then(setCierres).catch(e => toast.error(e.message)).finally(() => setLoading(false))
  }, [sucursalEf, desde, hasta, soloPendientes])

  useEffect(() => {
    if (drawer) { setValoresCorrob(valoresCorrobInicial(drawer)); setObsAdmin(drawer.observaciones_admin ?? '') }
    else { setValoresCorrob(null); setObsAdmin('') }
  }, [drawer])

  const totalCorrob = useMemo(() => {
    if (!valoresCorrob) return 0
    return MEDIOS.reduce((s, m) => s + Number(valoresCorrob[`${m.key}_corrob`] ?? 0), 0)
  }, [valoresCorrob])

  const totalDecl = Number(drawer?.total_declarado ?? 0)
  const diferencia = totalCorrob - totalDecl
  const estadoPreview = clasificarPorDiferencia(diferencia, umbrales)
  const obsRequerida = diferencia !== 0 && obsAdmin.trim() === ''

  async function handleCorroborar() {
    if (!drawer || !valoresCorrob) return
    setSaving(true)
    try {
      const updated = await corroborarCierre({ id: drawer.id, ...valoresCorrob, observaciones_admin: obsAdmin.trim() || null })
      toast.success(`Cierre corroborado — estado: ${updated.estado}`)
      setCierres(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated, vendedor_nombre: c.vendedor_nombre, sucursal_nombre: c.sucursal_nombre } : c))
      setDrawer(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error al corroborar') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Filtros */}
      <div style={cardSt}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label style={labelSt}>Sucursal</label>
            <select style={selectSt} value={sucursalSel} disabled={!puedeElegirSuc} onChange={e => setSucursalSel(e.target.value)}>
              {puedeElegirSuc && <option value="all">Todas</option>}
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div>
            <label style={labelSt}>Desde</label>
            <input type="date" style={inputSt} value={desde} onChange={e => setDesde(e.target.value)} />
          </div>
          <div>
            <label style={labelSt}>Hasta</label>
            <input type="date" style={inputSt} value={hasta} onChange={e => setHasta(e.target.value)} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={soloPendientes} onChange={e => setSoloPendientes(e.target.checked)} />
            Solo pendientes
          </label>
        </div>
      </div>

      {/* Tabla */}
      <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Fecha', 'Sucursal', 'Vendedor', 'Declarado', 'BSALE API', 'Brecha BSALE', 'Estado', 'Días pdte', ''].map(h => (
                  <th key={h} style={{ ...TH, textAlign: ['Declarado', 'BSALE API', 'Brecha BSALE', 'Días pdte'].includes(h) ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} style={{ ...TD, textAlign: 'center', padding: '40px 0' }}><Loader2 size={20} style={{ display: 'inline-block', color: '#9CA3AF' }} /></td></tr>}
              {!loading && cierres.length === 0 && <tr><td colSpan={9} style={{ ...TD, textAlign: 'center', padding: '40px 0', color: '#9CA3AF' }}>Sin cierres en este filtro</td></tr>}
              {!loading && cierres.map(c => {
                const dias = c.estado === 'declarado' && c.declarado_at
                  ? Math.floor((Date.now() - new Date(c.declarado_at).getTime()) / (1000 * 60 * 60 * 24)) : null
                const brecha = Number(c.brecha_bsale ?? 0)
                const brechaAbs = Math.abs(brecha)
                const brechaColor = brechaAbs <= umbrales.cuadra ? { bg: '#DCFCE7', color: '#166534' } : brechaAbs <= umbrales.tolerable ? { bg: '#FEF9C3', color: '#854D0E' } : { bg: '#FEE2E2', color: '#991B1B' }
                return (
                  <tr key={c.id} style={{ borderTop: '1px solid #F3F4F6' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#F9FAFB'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={TD}>{c.fecha}</td>
                    <td style={TD}>{c.sucursal_nombre ?? '—'}</td>
                    <td style={TD}>{c.vendedor_nombre ?? '—'}</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{formatCLP(c.total_declarado)}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>{c.venta_bsale_api == null ? '—' : formatCLP(c.venta_bsale_api)}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, ...brechaColor }}>{formatCLP(brecha)}</span>
                    </td>
                    <td style={TD}>{estadoBadge(c.estado)}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>{dias ?? '—'}</td>
                    <td style={TD}>
                      <button onClick={() => setDrawer(c)}
                        style={{ ...btnSt(c.estado === 'declarado' ? '#1F4E79' : '#6B7280'), padding: '4px 12px', fontSize: 12 }}>
                        {c.estado === 'declarado' ? 'Corroborar' : 'Ver'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer corroborar */}
      {drawer && valoresCorrob && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex' }}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)' }} onClick={() => setDrawer(null)} />
          <aside style={{ width: 640, maxWidth: '100%', height: '100%', background: '#fff', display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', overflowY: 'auto' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #F3F4F6' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>
                Corroborar cierre — {drawer.vendedor_nombre ?? '—'} · {drawer.fecha}
              </div>
            </div>

            <div style={{ flex: 1, padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* Lo que declaró */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Lo que declaró el vendedor</div>
                <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '12px 14px', fontSize: 12 }}>
                  {MEDIOS.map(m => (
                    <div key={m.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                      <span style={{ color: '#6B7280' }}>{m.label}</span>
                      <span>{formatCLP(Number(drawer[m.key] ?? 0))}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #E5E7EB', marginTop: 8, paddingTop: 8, fontWeight: 700 }}>
                    <span>Total declarado</span><span>{formatCLP(totalDecl)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6B7280', marginTop: 4 }}>
                    <span>Según BSALE</span>
                    <span>{drawer.venta_bsale_api == null ? '—' : formatCLP(drawer.venta_bsale_api)}</span>
                  </div>
                  {drawer.observaciones_vendedor && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #E5E7EB', fontSize: 11, color: '#374151' }}>
                      <span style={{ color: '#6B7280' }}>Obs vendedor: </span>{drawer.observaciones_vendedor}
                    </div>
                  )}
                </div>
              </div>

              {/* Lo que corrobora */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Lo que corrobora el admin</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {MEDIOS.map(m => {
                    const k = `${m.key}_corrob`
                    return (
                      <div key={m.key} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', gap: 8 }}>
                        <label style={{ ...labelSt, marginBottom: 0 }}>{m.label}</label>
                        <MoneyInput disabled={drawer.estado !== 'declarado'} value={valoresCorrob[k]} onChange={n => setValoresCorrob(p => p ? { ...p, [k]: n } : p)} />
                      </div>
                    )
                  })}
                </div>
                <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 14px', fontSize: 12, marginTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#6B7280' }}>Total corroborado</span>
                    <span style={{ fontWeight: 600 }}>{formatCLP(totalCorrob)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <span style={{ color: '#6B7280' }}>Diferencia</span>
                    <span style={{ fontWeight: 600, color: Math.abs(diferencia) <= umbrales.cuadra ? '#16A34A' : Math.abs(diferencia) <= umbrales.tolerable ? '#D97706' : '#DC2626' }}>
                      {formatCLP(diferencia)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #E5E7EB', marginTop: 8, paddingTop: 8 }}>
                    <span style={{ color: '#6B7280', fontSize: 11 }}>Estado tras firmar</span>
                    {estadoBadge(estadoPreview)}
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={labelSt}>Observaciones admin {diferencia !== 0 && <span style={{ color: '#DC2626' }}>*</span>}</label>
                  <textarea disabled={drawer.estado !== 'declarado'} value={obsAdmin} onChange={e => setObsAdmin(e.target.value)} rows={3}
                    placeholder={diferencia !== 0 ? 'Obligatorio: explica la diferencia' : 'Opcional'}
                    style={{ ...inputSt, resize: 'vertical', fontFamily: 'inherit', borderColor: obsRequerida ? '#DC2626' : '#D1D5DB' }} />
                </div>
              </div>
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setDrawer(null)} style={btnOutlineSt}>Cancelar</button>
              {drawer.estado === 'declarado' && (
                <button onClick={handleCorroborar} disabled={saving || obsRequerida}
                  style={{ ...btnSt(), opacity: saving || obsRequerida ? 0.6 : 1 }}>
                  {saving && <Loader2 size={13} />}
                  Confirmar corroboración
                </button>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
