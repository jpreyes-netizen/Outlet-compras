import { useMemo, useState, useEffect } from 'react'
import { toast } from 'sonner'
import { X, Loader2 } from 'lucide-react'
import { supabase } from '../../supabase'

const PRIMARY = '#1F4E79'

export function LoteModal({ ids, cuentas, subcuentas, cecos, respaldoTipos, onClose, onSaved }) {
  const [cuentaMadreId, setCuentaMadreId] = useState('')
  const [subcuentaId, setSubcuentaId] = useState('')
  const [cecoId, setCecoId] = useState('')
  const [tipoRespaldo, setTipoRespaldo] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [saving, setSaving] = useState(false)

  const subcuentasFiltradas = useMemo(
    () => subcuentas.filter(s => s.cuenta_madre_id === cuentaMadreId),
    [subcuentas, cuentaMadreId]
  )

  useEffect(() => {
    if (subcuentaId && !subcuentasFiltradas.some(s => s.id === subcuentaId)) setSubcuentaId('')
  }, [cuentaMadreId, subcuentasFiltradas, subcuentaId])

  const valido = !!subcuentaId && !!tipoRespaldo
  const [confirmando, setConfirmando] = useState(false)

  async function handleSave() {
    if (!valido) { toast.error('Selecciona subcuenta y tipo de respaldo'); return }
    if (!confirmando) { setConfirmando(true); return }  // primer click pide confirmación
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
      }).in('id', ids)
      if (error) throw error
      toast.success(`${ids.length} movimientos clasificados`)
      onSaved({
        subcuenta_id: subcuentaId,
        ceco_id: cecoId || null,
        tipo_respaldo: tipoRespaldo,
        ids,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const subcuentaSelec = subcuentas.find(s => s.id === subcuentaId)
  const cuentaSelec    = cuentas.find(c => c.id === cuentaMadreId)

  const selectSt = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 13, background: '#fff', color: '#374151', outline: 'none' }
  const labelSt = { fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 480, background: '#fff', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #F3F4F6' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>Clasificar en lote</div>
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{ids.length} movimientos seleccionados</div>
          </div>
          <button onClick={onClose} disabled={saving} style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: '#F3F4F6', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280' }}>
            <X size={15} />
          </button>
        </div>

        {/* Contenido */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
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
              style={{ ...selectSt, background: !cuentaMadreId ? '#F9FAFB' : '#fff' }}>
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
        </div>

        {/* Confirmación inline */}
        {confirmando && valido && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid #F3F4F6', background: '#FEF3C7' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 6 }}>
              ⚠ Confirma la clasificación masiva
            </div>
            <div style={{ fontSize: 12, color: '#78350F', lineHeight: 1.5 }}>
              Se van a clasificar <strong>{ids.length} movimientos</strong> como:
              <div style={{ marginTop: 6, padding: '6px 10px', background: '#FEF9C3', borderRadius: 6, fontFamily: 'monospace', fontSize: 11 }}>
                <strong>{cuentaSelec?.nombre ?? '—'}</strong> → <strong>{subcuentaSelec?.nombre ?? '—'}</strong>
                <br />
                Respaldo: {tipoRespaldo.replace(/_/g, ' ')}
              </div>
              <div style={{ marginTop: 6, fontSize: 11 }}>
                <strong>Esta acción no se puede revertir automáticamente.</strong> Verifica que la cantidad y la clasificación sean correctas.
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid #F3F4F6' }}>
          {confirmando && (
            <button onClick={() => setConfirmando(false)} disabled={saving}
              style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
              ← Volver
            </button>
          )}
          {!confirmando && (
            <button onClick={onClose} disabled={saving}
              style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', fontSize: 13, color: '#374151', cursor: 'pointer' }}>
              Cancelar
            </button>
          )}
          <button onClick={handleSave} disabled={saving || !valido}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 7, border: 'none',
              background: !valido ? '#9CA3AF' : confirmando ? '#DC2626' : PRIMARY,
              fontSize: 13, fontWeight: 600, color: '#fff',
              cursor: valido && !saving ? 'pointer' : 'not-allowed',
            }}>
            {saving && <Loader2 size={13} />}
            {confirmando ? `✓ Sí, clasificar ${ids.length} movimientos` : `Aplicar a ${ids.length} movimientos`}
          </button>
        </div>
      </div>
    </div>
  )
}
