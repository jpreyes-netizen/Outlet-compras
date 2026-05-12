import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, AlertCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../supabase'
import {
  MEDIOS, MEDIOS_PRINCIPALES, MEDIOS_OTROS, UMBRALES_DEFAULT,
  formatCLP, parseCLP, todayISO, inputSt, selectSt, labelSt, cardSt, btnSt, btnOutlineSt, estadoBadge,
} from './types'
import { declararCierre, actualizarDeclaracion, fetchSucursales, fetchUmbrales, fetchVentaBsale, fetchCierreDelDia } from './api'

function valoresVacios() {
  return MEDIOS.reduce((a, m) => ({ ...a, [m.key]: 0 }), {})
}

function MoneyInput({ value, onChange, disabled }) {
  const [text, setText] = useState(value ? formatCLP(value) : '')
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(value ? formatCLP(value) : '') }, [value, focused])
  return (
    <input type="text" inputMode="numeric" disabled={disabled}
      placeholder="$0" value={text}
      style={{ ...inputSt, textAlign: 'right', background: disabled ? '#F9FAFB' : '#fff' }}
      onFocus={e => { setFocused(true); setText(value ? String(value) : ''); setTimeout(() => e.target.select(), 0) }}
      onChange={e => { setText(e.target.value); onChange(parseCLP(e.target.value)) }}
      onBlur={() => { setFocused(false); setText(value ? formatCLP(value) : '') }}
    />
  )
}

export function DeclararCierreTab({ usuario }) {
  const fecha = todayISO()
  const isAdmin = usuario.rol === "admin_sistema" || usuario.rol === "admin"

  const [sucursales, setSucursales] = useState([])
  const [sucursalSel, setSucursalSel] = useState(usuario.sucursal_id ?? '')
  const [umbrales, setUmbrales] = useState(UMBRALES_DEFAULT)
  const [cierre, setCierre] = useState(null)
  const [loadingCierre, setLoadingCierre] = useState(true)
  const [valores, setValores] = useState(valoresVacios())
  const [observaciones, setObservaciones] = useState('')
  const [otrosAbierto, setOtrosAbierto] = useState(false)
  const [confirmCero, setConfirmCero] = useState(false)
  const [saving, setSaving] = useState(false)
  const [ventaBsale, setVentaBsale] = useState(null)
  const [loadingBsale, setLoadingBsale] = useState(false)

  const sucursalId = isAdmin ? sucursalSel : (usuario.sucursal_id ?? '')

  useEffect(() => {
    fetchSucursales().then(setSucursales).catch(() => {})
    fetchUmbrales().then(setUmbrales).catch(() => {})
  }, [])

  useEffect(() => {
    setLoadingCierre(true)
    fetchCierreDelDia(usuario.id, fecha).then(c => {
      setCierre(c)
      if (c) {
        const v = valoresVacios()
        for (const m of MEDIOS) v[m.key] = Number(c[m.key] ?? 0)
        setValores(v)
        setObservaciones(c.observaciones_vendedor ?? '')
        if (MEDIOS_OTROS.some(m => v[m.key] > 0)) setOtrosAbierto(true)
      }
    }).catch(() => {}).finally(() => setLoadingCierre(false))
  }, [usuario.id, fecha])

  useEffect(() => {
    if (!sucursalId) return
    setLoadingBsale(true)
    fetchVentaBsale(fecha, sucursalId, usuario.id).then(setVentaBsale).catch(() => setVentaBsale(null)).finally(() => setLoadingBsale(false))
  }, [fecha, sucursalId, usuario.id])

  const total = useMemo(() => MEDIOS.reduce((s, m) => s + (valores[m.key] || 0), 0), [valores])
  const brecha = ventaBsale != null ? ventaBsale - total : null
  const brechaAbs = brecha != null ? Math.abs(brecha) : 0
  const brechaColor = brecha == null ? '#6B7280' : brechaAbs <= umbrales.cuadra ? '#16A34A' : brechaAbs <= umbrales.tolerable ? '#D97706' : '#DC2626'

  const esEditable = !cierre || cierre.estado === 'declarado'
  const esReadOnly = !!cierre && cierre.estado !== 'declarado'

  async function firmar() {
    if (!sucursalId) { toast.error('Selecciona una sucursal'); return }
    setSaving(true)
    try {
      const payload = { fecha, sucursal_id: sucursalId, vendedor_id: usuario.id, observaciones_vendedor: observaciones.trim() || null, venta_bsale_api: ventaBsale, ...valores }
      const nuevo = cierre?.id ? await actualizarDeclaracion(cierre.id, payload) : await declararCierre(payload)
      setCierre(nuevo)
      toast.success('Cierre firmado correctamente')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/duplicate|unique|23505/i.test(msg)) toast.error('Ya existe un cierre para esta fecha')
      else toast.error(msg || 'Error al firmar')
    } finally { setSaving(false) }
  }

  if (loadingCierre) return (
    <div style={{ ...cardSt, textAlign: 'center', padding: 40 }}>
      <Loader2 size={24} style={{ display: 'inline-block', color: '#9CA3AF' }} />
    </div>
  )

  if (!sucursalId && !isAdmin) return (
    <div style={{ ...cardSt, textAlign: 'center', color: '#6B7280', fontSize: 13 }}>
      Tu usuario no tiene una sucursal asignada. Pide a un administrador que te configure.
    </div>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Info cierre */}
        <div style={cardSt}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>Cierre del {fecha}</div>
            {cierre && estadoBadge(cierre.estado)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelSt}>Vendedor</label>
              <input style={{ ...inputSt, background: '#F9FAFB' }} disabled value={usuario.nombre ?? '—'} />
            </div>
            <div>
              <label style={labelSt}>Sucursal</label>
              {isAdmin ? (
                <select style={selectSt} value={sucursalSel} onChange={e => setSucursalSel(e.target.value)}>
                  <option value="">Selecciona…</option>
                  {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              ) : (
                <input style={{ ...inputSt, background: '#F9FAFB' }} disabled value={sucursales.find(s => s.id === usuario.sucursal_id)?.nombre ?? '—'} />
              )}
            </div>
            <div>
              <label style={labelSt}>Fecha</label>
              <input style={{ ...inputSt, background: '#F9FAFB' }} disabled value={fecha} />
            </div>
          </div>
        </div>

        {/* Medios principales */}
        <div style={cardSt}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 12 }}>Medios de pago — Principales</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {MEDIOS_PRINCIPALES.map(m => (
              <div key={m.key}>
                <label style={labelSt}>{m.label}</label>
                <MoneyInput disabled={esReadOnly} value={valores[m.key]} onChange={n => setValores(p => ({ ...p, [m.key]: n }))} />
              </div>
            ))}
          </div>
        </div>

        {/* Otros medios */}
        <div style={cardSt}>
          <button onClick={() => setOtrosAbierto(v => !v)} style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Otros medios</span>
            {otrosAbierto ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {otrosAbierto && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              {MEDIOS_OTROS.map(m => (
                <div key={m.key}>
                  <label style={labelSt}>{m.label}</label>
                  <MoneyInput disabled={esReadOnly} value={valores[m.key]} onChange={n => setValores(p => ({ ...p, [m.key]: n }))} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Observaciones */}
        <div style={cardSt}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 12 }}>Observaciones</div>
          <textarea disabled={esReadOnly} value={observaciones} onChange={e => setObservaciones(e.target.value)}
            placeholder="Notas opcionales del vendedor" rows={3}
            style={{ ...inputSt, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        {/* Botones */}
        {esEditable && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={() => { if (total === 0) { setConfirmCero(true) } else { firmar() } }} disabled={saving}
              style={{ ...btnSt(), opacity: saving ? 0.6 : 1 }}>
              {saving && <Loader2 size={14} />}
              {cierre ? 'Actualizar y firmar' : 'Firmar cierre'}
            </button>
          </div>
        )}
      </div>

      {/* Panel lateral BSALE */}
      <div style={{ ...cardSt, alignSelf: 'start', position: 'sticky', top: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 12 }}>Resumen en vivo</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
          <div>
            <div style={{ color: '#6B7280', fontSize: 11, marginBottom: 2 }}>Tu declaración</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{formatCLP(total)}</div>
          </div>
          <div>
            <div style={{ color: '#6B7280', fontSize: 11, marginBottom: 2 }}>Según BSALE hoy</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>
              {loadingBsale ? '…' : ventaBsale == null ? 'No disponible' : formatCLP(ventaBsale)}
            </div>
          </div>
          <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: 12 }}>
            <div style={{ color: '#6B7280', fontSize: 11, marginBottom: 4 }}>Brecha BSALE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 16, fontWeight: 600, color: brechaColor }}>
              {brecha != null && (brechaAbs <= umbrales.cuadra ? <CheckCircle2 size={16} /> : brechaAbs <= umbrales.tolerable ? <AlertCircle size={16} /> : <AlertTriangle size={16} />)}
              {brecha == null ? '—' : formatCLP(brecha)}
            </div>
            <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>
              Cuadra ≤ {formatCLP(umbrales.cuadra)} · Tolerable ≤ {formatCLP(umbrales.tolerable)}
            </div>
          </div>
        </div>
      </div>

      {/* Modal confirmar $0 */}
      {confirmCero && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 400, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>¿Estás seguro?</div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 20 }}>Tu declaración es <strong>$0</strong>. ¿Confirmas que no hubo ventas hoy?</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setConfirmCero(false)} style={btnOutlineSt}>Cancelar</button>
              <button onClick={() => { setConfirmCero(false); firmar() }} style={btnSt()}>Sí, firmar en $0</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
