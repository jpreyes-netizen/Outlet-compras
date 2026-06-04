import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Sparkles } from 'lucide-react'
import { supabase } from '../../supabase'
import { extraerRut, palabrasSignificativas, normalizarPatron } from './types'

const PRIMARY = '#1F4E79'

function formatCLP(n) {
  return '$' + Math.round(n).toLocaleString('es-CL')
}

export function ClasificarPanel({ movimiento, cuentas, subcuentas, cecos, respaldoTipos, sugerencia, onClose, onSaved }) {
  const subById = useMemo(() => new Map(subcuentas.map(s => [s.id, s])), [subcuentas])

  const [cuentaMadreId, setCuentaMadreId] = useState('')
  const [subcuentaId, setSubcuentaId]     = useState('')
  const [cecoId, setCecoId]               = useState('')
  const [tipoRespaldo, setTipoRespaldo]   = useState('')
  const [observaciones, setObservaciones] = useState(movimiento.observaciones ?? '')
  const [saving, setSaving]               = useState(false)

  // Inicializar campos cuando lleguen subcuentas (pueden llegar después del primer render)
  useEffect(() => {
    if (subcuentas.length === 0) return  // aún cargando
    const subId  = movimiento.subcuenta_id ?? sugerencia?.subcuenta_id ?? ''
    const cuentaId = subId ? (subById.get(subId)?.cuenta_madre_id ?? '') : ''
    setCuentaMadreId(cuentaId)
    setSubcuentaId(subId)
    setCecoId(movimiento.ceco_id ?? sugerencia?.ceco_id ?? '')
    setTipoRespaldo(movimiento.tipo_respaldo ?? sugerencia?.tipo_respaldo ?? '')
  }, [subcuentas])  // solo cuando llegan las subcuentas

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

      // ── Aprendizaje automático (siempre, no requiere check) ──
      // Si tiene RUT → regla por RUT (más confiable)
      // Si no → patrón normalizado de descripción (validación estricta)
      const rut = extraerRut(movimiento.descripcion)
      let tipo_regla = null, patron = null
      if (rut) { tipo_regla = 'rut'; patron = rut }
      else {
        const pat = normalizarPatron(movimiento.descripcion)
        // Validación estricta: ≥15 caracteres Y ≥2 palabras
        // Esto evita patrones genéricos como "TRANSF" o "COMPRA" que matchean demasiado
        if (pat && pat.length >= 15 && pat.split(/\s+/).length >= 2) {
          tipo_regla = 'descripcion_contiene'
          patron = pat
        }
      }

      if (tipo_regla && patron) {
        // Buscar si ya existe la misma regla (mismo patrón + misma subcuenta = +1 acierto)
        const { data: existing } = await supabase.from('reglas_clasificacion')
          .select('id, aciertos')
          .eq('tipo_regla', tipo_regla)
          .eq('patron', patron)
          .eq('subcuenta_id', subcuentaId)
          .maybeSingle()

        if (existing) {
          // Reforzar regla existente
          await supabase.from('reglas_clasificacion')
            .update({ aciertos: (existing.aciertos ?? 0) + 1 })
            .eq('id', existing.id)
        } else {
          // Crear nueva regla aprendida
          await supabase.from('reglas_clasificacion').insert({
            tipo_regla, patron,
            subcuenta_id: subcuentaId,
            ceco_id: cecoId || null,
            tipo_respaldo: tipoRespaldo,
            aciertos: 1,
          })
        }
      }

      toast.success('✓ Movimiento clasificado · IA aprendió el patrón')
      onSaved({
        descripcion: movimiento.descripcion,
        subcuenta_id: subcuentaId,
        ceco_id: cecoId || null,
        tipo_respaldo: tipoRespaldo,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const selectSt = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 13, background: '#fff', color: '#374151', outline: 'none' }
  const labelSt = { fontSize: 11, fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: 4 }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', pointerEvents: 'none' }}>
      <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)', pointerEvents: 'auto' }} onClick={onClose} />
      <aside style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 70,
        width: 400,
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        zIndex: 101,
        pointerEvents: 'auto',
      }}>
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

          {/* Sugerencia IA — con botón aplicar */}
          {sugerencia && (
            <div style={{
              borderRadius: 10,
              border: `2px solid ${sugerencia.nivel === 'alto' ? '#86EFAC' : sugerencia.nivel === 'medio' ? '#FCD34D' : '#FCA5A5'}`,
              background: sugerencia.nivel === 'alto' ? '#F0FDF4' : sugerencia.nivel === 'medio' ? '#FFFBEB' : '#FEF2F2',
              padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <Sparkles size={13} color={sugerencia.nivel === 'alto' ? '#16A34A' : sugerencia.nivel === 'medio' ? '#D97706' : '#DC2626'} />
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: sugerencia.nivel === 'alto' ? '#166534' : sugerencia.nivel === 'medio' ? '#92400E' : '#991B1B' }}>
                      Sugerencia IA · {sugerencia.score ?? '?'}% confianza
                    </span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 2 }}>
                    {sugerencia.subcuenta_nombre}
                  </div>
                  {sugerencia.razon && (
                    <div style={{ fontSize: 11, color: '#6B7280', fontStyle: 'italic' }}>{sugerencia.razon}</div>
                  )}
                  {sugerencia.tipo_respaldo && (
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                      Respaldo: <strong>{sugerencia.tipo_respaldo.replace(/_/g,' ')}</strong>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    const cuentaId = subById.get(sugerencia.subcuenta_id)?.cuenta_madre_id ?? ''
                    setCuentaMadreId(cuentaId)
                    setSubcuentaId(sugerencia.subcuenta_id)
                    if (sugerencia.ceco_id) setCecoId(sugerencia.ceco_id)
                    if (sugerencia.tipo_respaldo) setTipoRespaldo(sugerencia.tipo_respaldo)
                  }}
                  style={{
                    flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '7px 12px', borderRadius: 7, border: 'none',
                    background: sugerencia.nivel === 'alto' ? '#16A34A' : sugerencia.nivel === 'medio' ? '#D97706' : '#6B7280',
                    color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>
                  <Sparkles size={11} /> Aplicar
                </button>
              </div>
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

          <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#166534', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={12} />
            <span>La IA aprenderá automáticamente este patrón para futuros movimientos similares.</span>
          </div>
        </div>

        {/* Footer — sticky para que siempre se vea */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
          padding: '14px 20px',
          borderTop: '1px solid #E5E7EB',
          background: '#fff',
          boxShadow: '0 -4px 12px rgba(0,0,0,0.06)',
          flexShrink: 0,
          zIndex: 1,
        }}>
          <button onClick={onClose} disabled={saving} style={{ padding: '9px 18px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', fontSize: 13, fontWeight: 500, color: '#374151', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !valido}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '9px 20px', borderRadius: 7, border: 'none',
              background: valido && !saving ? PRIMARY : '#9CA3AF',
              fontSize: 13, fontWeight: 700, color: '#fff',
              cursor: valido && !saving ? 'pointer' : 'not-allowed',
              boxShadow: valido && !saving ? '0 2px 6px rgba(31,78,121,0.3)' : 'none',
            }}>
            {saving && <Loader2 size={13} />}
            ✓ Guardar clasificación
          </button>
        </div>
      </aside>
    </div>
  )
}
