import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { X, Loader2 } from 'lucide-react'
import { supabase } from '../../supabase'
import {
  type Movimiento,
  type CuentaMadre,
  type Subcuenta,
  type CentroCosto,
  type Sugerencia,
  type RespaldoTipo,
  extraerRut,
  palabrasSignificativas,
} from './types'

const PRIMARY = '#1F4E79'

function formatCLP(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-CL')
}

export function ClasificarPanel({
  movimiento,
  cuentas,
  subcuentas,
  cecos,
  respaldoTipos,
  sugerencia,
  onClose,
  onSaved,
}: {
  movimiento: Movimiento
  cuentas: CuentaMadre[]
  subcuentas: Subcuenta[]
  cecos: CentroCosto[]
  respaldoTipos: readonly RespaldoTipo[]
  sugerencia: Sugerencia | null
  onClose: () => void
  onSaved: () => void
}) {
  const subById = useMemo(
    () => new Map(subcuentas.map((s) => [s.id, s])),
    [subcuentas],
  )

  const initSubId = movimiento.subcuenta_id ?? sugerencia?.subcuenta_id ?? ''
  const initCuentaMadreId = initSubId
    ? subById.get(initSubId)?.cuenta_madre_id ?? ''
    : ''

  const [cuentaMadreId, setCuentaMadreId] = useState<string>(initCuentaMadreId)
  const [subcuentaId, setSubcuentaId] = useState<string>(initSubId)
  const [cecoId, setCecoId] = useState<string>(
    movimiento.ceco_id ?? sugerencia?.ceco_id ?? '',
  )
  const [tipoRespaldo, setTipoRespaldo] = useState<string>(
    movimiento.tipo_respaldo ?? sugerencia?.tipo_respaldo ?? '',
  )
  const [observaciones, setObservaciones] = useState<string>(
    movimiento.observaciones ?? '',
  )
  const [recordar, setRecordar] = useState<boolean>(false)
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
        .eq('id', movimiento.id)
      if (error) throw error

      if (recordar) {
        const rut = extraerRut(movimiento.descripcion)
        let tipo_regla: string | null = null
        let patron: string | null = null
        if (rut) {
          tipo_regla = 'rut'
          patron = rut
        } else {
          const pal = palabrasSignificativas(movimiento.descripcion, 4)
          if (pal.length === 0) {
            toast.warning('No se pudo crear regla automática (descripción muy corta)')
          } else {
            tipo_regla = 'descripcion_contiene'
            patron = pal.join(' ')
          }
        }
        if (tipo_regla && patron) {
          const { error: regErr } = await supabase
            .from('reglas_clasificacion')
            .insert({
              tipo_regla,
              patron,
              subcuenta_id: subcuentaId,
              ceco_id: cecoId || null,
              tipo_respaldo: tipoRespaldo,
              aciertos: 0,
            })
          if (regErr) {
            toast.warning('Movimiento guardado, regla falló: ' + regErr.message)
          }
        }
      }

      toast.success('Movimiento clasificado')
      onSaved()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al guardar'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="flex h-full w-[400px] flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-800">
            Clasificar movimiento
          </h3>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {/* Info del movimiento */}
          <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
            <div className="flex justify-between">
              <span className="text-gray-500">Fecha</span>
              <span>{movimiento.fecha}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-gray-500">Monto</span>
              <span>
                <span
                  className="mr-2 inline-block rounded px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: movimiento.tipo === 'ABONO' ? '#DCFCE7' : '#FEE2E2',
                    color: movimiento.tipo === 'ABONO' ? '#166534' : '#991B1B',
                  }}
                >
                  {movimiento.tipo}
                </span>
                <strong>{formatCLP(movimiento.monto)}</strong>
              </span>
            </div>
            <div className="mt-2 text-gray-500">Descripción</div>
            <div className="text-gray-800">{movimiento.descripcion}</div>
            {movimiento.saldo != null && (
              <div className="mt-2 flex justify-between">
                <span className="text-gray-500">Saldo después</span>
                <span>{formatCLP(movimiento.saldo)}</span>
              </div>
            )}
          </div>

          {sugerencia && (
            <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
              Sugerencia: <strong>{sugerencia.subcuenta_nombre}</strong>{' '}
              <span className="text-blue-600">({sugerencia.fuente})</span>
            </div>
          )}

          {/* Formulario */}
          <div className="mt-4 space-y-3">
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

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={recordar}
                onChange={(e) => setRecordar(e.target.checked)}
              />
              Recordar para el futuro (crea regla automática)
            </label>
          </div>
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
            Guardar clasificación
          </button>
        </footer>
      </aside>
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
