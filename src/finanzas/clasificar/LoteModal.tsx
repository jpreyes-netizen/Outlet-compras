import { useMemo, useState, useEffect } from 'react'
import { toast } from 'sonner'
import { X, Loader2 } from 'lucide-react'
import { supabase } from '../../supabase'
import {
  type CuentaMadre,
  type Subcuenta,
  type CentroCosto,
  type RespaldoTipo,
} from './types'

const PRIMARY = '#1F4E79'

export function LoteModal({
  ids,
  cuentas,
  subcuentas,
  cecos,
  respaldoTipos,
  onClose,
  onSaved,
}: {
  ids: string[]
  cuentas: CuentaMadre[]
  subcuentas: Subcuenta[]
  cecos: CentroCosto[]
  respaldoTipos: readonly RespaldoTipo[]
  onClose: () => void
  onSaved: () => void
}) {
  const [cuentaMadreId, setCuentaMadreId] = useState('')
  const [subcuentaId, setSubcuentaId] = useState('')
  const [cecoId, setCecoId] = useState('')
  const [tipoRespaldo, setTipoRespaldo] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [saving, setSaving] = useState(false)

  const subcuentasFiltradas = useMemo(
    () => subcuentas.filter((s) => s.cuenta_madre_id === cuentaMadreId),
    [subcuentas, cuentaMadreId],
  )

  useEffect(() => {
    if (subcuentaId && !subcuentasFiltradas.some((s) => s.id === subcuentaId)) {
      setSubcuentaId('')
    }
  }, [cuentaMadreId, subcuentasFiltradas, subcuentaId])

  const valido = !!subcuentaId && !!tipoRespaldo

  async function handleSave() {
    if (!valido) {
      toast.error('Selecciona subcuenta y tipo de respaldo')
      return
    }
    setSaving(true)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const userId = sess.session?.user?.id ?? null
      const { error } = await supabase
        .from('movimientos_bancarios')
        .update({
          subcuenta_id: subcuentaId,
          ceco_id: cecoId || null,
          tipo_respaldo: tipoRespaldo,
          observaciones: observaciones.trim() || null,
          estado: 'clasificado',
          clasificado_por: userId,
          clasificado_at: new Date().toISOString(),
        })
        .in('id', ids)
      if (error) throw error
      toast.success(`${ids.length} movimientos clasificados`)
      onSaved()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al guardar'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-800">
              Clasificar en lote
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {ids.length} movimientos seleccionados
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <Field label="Cuenta madre">
            <select
              value={cuentaMadreId}
              onChange={(e) => setCuentaMadreId(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">Selecciona…</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Subcuenta">
            <select
              value={subcuentaId}
              onChange={(e) => setSubcuentaId(e.target.value)}
              disabled={!cuentaMadreId}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100"
            >
              <option value="">Selecciona…</option>
              {subcuentasFiltradas.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Centro de costo">
            <select
              value={cecoId}
              onChange={(e) => setCecoId(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">— Sin asignar —</option>
              {cecos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tipo de respaldo">
            <select
              value={tipoRespaldo}
              onChange={(e) => setTipoRespaldo(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">Selecciona…</option>
              {respaldoTipos.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Observaciones">
            <textarea
              rows={3}
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </Field>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !valido}
            className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: PRIMARY }}
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Aplicar a {ids.length} movimientos
          </button>
        </footer>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  )
}
