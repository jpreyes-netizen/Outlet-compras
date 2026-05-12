import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { X, Loader2 } from 'lucide-react'
import { supabase } from '../../supabase'
import { extraerRut, palabrasSignificativas } from './types'

const PRIMARY = '#1F4E79'

function formatCLP(n) {
  return '$' + Math.round(n).toLocaleString('es-CL')
}

export function ClasificarPanel({ movimiento, cuentas, subcuentas, cecos, respaldoTipos, sugerencia, onClose, onSaved }) {
  const subById = useMemo(() => new Map(subcuentas.map(s => [s.id, s])), [subcuentas])

  const initSubId = movimiento.subcuenta_id ?? sugerencia?.subcuenta_id ?? ''
  const initCuentaMadreId = initSubId ? subById.get(initSubId)?.cuenta_madre_id ?? '' : ''

  const [cuentaMadreId, setCuentaMadreId] = useState(initCuentaMadreId)
  const [subcuentaId, setSubcuentaId] = useState(initSubId)
  const [cecoId, setCecoId] = useState(movimiento.ceco_id ?? sugerencia?.ceco_id ?? '')
  const [tipoRespaldo, setTipoRespaldo] = useState(movimiento.tipo_respaldo ?? sugerencia?.tipo_respaldo ?? '')
  const [observaciones, setObservaciones] = useState(movimiento.observaciones ?? '')
  const [recordar, setRecordar] = useState(false)
  const [saving, setSaving] = useState(false)

  const subcuentasFiltradas = useMemo(
    () => subcuentas.filter(s => s.cuenta_madre_id === cuentaMadreId),
    [subcuentas, cuentaMadreId]
  )

  useEffect(() => {
    if (subcuentaId && !subcuentasFiltradas.some(s => s.id === subcuentaId)) setSubcuentaId('')
  }, [cuentaMadreId, subcuentasFiltradas, subcuentaId])

  const valido = !!subcuentaId && !!tipoRespaldo

  async function handleSave() {
    if (!valido) { toast.error('Selecciona subcuenta y tipo de respaldo'); return }
    setSaving(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const userId = sess.session?.user?.id ?? null
      const { error } = await supabase.from('movimientos_bancarios').update({
        subcuenta_id: subcuentaId,
        ceco_id: cecoId || null,
        tipo_respaldo: tipoRespaldo,
        observaciones: observaciones.trim() || null,
        estado: 'clasificado',
        clasificado_por: userId,
        clasificado_at: new Date().toISOString(),
      }).eq('id', movimiento.id)
      if (error) throw error

      if (recordar) {
        const rut = extraerRut(movimiento.descripcion)
        let tipo_regla = null, patron = null
        if (rut) { tipo_regla = 'rut'; patron = rut }
        else {
          const pal = palabrasSignificativas(movimiento.descripcion, 4)
          if (pal.length > 0) { tipo_regla = 'descripcion_contiene'; patron = pal.join(' ') }
          else toast.warning('No se pudo crear regla (descripción muy corta)')
        }
        if (tipo_regla && patron) {
          const { error: regErr } = await supabase.from('reglas_clasificacion').insert({ tipo_regla, patron, subcuenta_id: subcuentaId, ceco_id: cecoId || null, tipo_respaldo: tipoRespaldo, aciertos: 0 })
          if (regErr) toast.warning('Movimiento guardado, regla falló: ' + regErr.message)
        }
      }
      toast.success('Movimiento clasificado')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const selectSt = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 13, background: '#fff', color: '#374151', outline: 'none' }
  const labelSt = { fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex' }}>
      <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
      <aside style={{ width: 400, height: '100%', background: '#fff', display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #F3F4F6' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>Clasificar movimiento</div>
          <button onClick={onClose} disabled={saving} style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: '#F3F4F6', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280' }}>
            <X size={15} />
          </button>
        </div>

        {/* Contenido */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Info movimiento */}
          <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '12px 14px', fontSize: 13, color: '#374151', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#9CA3AF' }}>Fecha</span>
              <span>{movimiento.fecha}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#9CA3AF' }}>Monto</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: movimiento.tipo === 'ABONO' ? '#DCFCE7' : '#FEE2E2', color: movimiento.tipo === 'ABONO' ? '#166534' : '#991B1B' }}>{movimiento.tipo}</span>
                <strong>{formatCLP(movimiento.monto)}</strong>
              </span>
            </div>
            <div>
              <div style={{ color: '#9CA3AF', marginBottom: 2 }}>Descripción</div>
              <div style={{ color: '#111827', wordBreak: 'break-word', whiteSpace: 'normal' }}>{movimiento.descripcion}</div>
            </div>
          </div>

          {/* Sugerencia */}
          {sugerencia && (
            <div style={{ borderRadius: 8, border: '1px solid #BFDBFE', background: '#EFF6FF', padding: '10px 14px', fontSize: 12, color: '#1E40AF' }}>
              Sugerencia: <strong>{sugerencia.subcuenta_nombre}</strong> <span style={{ color: '#3B82F6' }}>({sugerencia.fuente})</span>
            </div>
          )}

          {/* Formulario */}
          <div>
            <label style={labelSt}>Cuenta madre</label>
            <select value={cuentaMadreId} onChange={e => setCuentaMadreId(e.target.value)} style={selectSt}>
              <option value="">Selecciona…</option>
              {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          <div>
            <label style={labelSt}>Subcuenta</label>
            <select value={subcuentaId} onChange={e => setSubcuentaId(e.target.value)} disabled={!cuentaMadreId}
              style={{ ...selectSt, background: !cuentaMadreId ? '#F9FAFB' : '#fff', color: !cuentaMadreId ? '#9CA3AF' : '#374151' }}>
              <option value="">Selecciona…</option>
              {subcuentasFiltradas.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>

          <div>
            <label style={labelSt}>Centro de costo</label>
            <select value={cecoId} onChange={e => setCecoId(e.target.value)} style={selectSt}>
              <option value="">— Sin asignar —</option>
              {cecos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          <div>
            <label style={labelSt}>Tipo de respaldo</label>
            <select value={tipoRespaldo} onChange={e => setTipoRespaldo(e.target.value)} style={selectSt}>
              <option value="">Selecciona…</option>
              {respaldoTipos.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
          </div>

          <div>
            <label style={labelSt}>Observaciones</label>
            <textarea rows={3} value={observaciones} onChange={e => setObservaciones(e.target.value)}
              style={{ ...selectSt, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
            <input type="checkbox" checked={recordar} onChange={e => setRecordar(e.target.checked)} />
            Recordar para el futuro (crea regla automática)
          </label>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid #F3F4F6' }}>
          <button onClick={onClose} disabled={saving} style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !valido} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 7, border: 'none', background: valido && !saving ? PRIMARY : '#9CA3AF', fontSize: 13, fontWeight: 500, color: '#fff', cursor: valido && !saving ? 'pointer' : 'not-allowed' }}>
            {saving && <Loader2 size={13} />}
            Guardar clasificación
          </button>
        </div>
      </aside>
    </div>
  )
}
