import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { fmt, hoy } from '../../lib/constants'
import { canSync } from '../../core/permisos'
import { Cd, Bd, Bt, Fl, Sheet, css } from '../../components/UI'
import { toast } from 'sonner'

const TIPOS_DOC    = ['Boleta', 'Factura', 'Ticket', 'Guía', 'Comprobante', 'Otro']
const METODOS_PAGO = ['Efectivo', 'Transferencia', 'T. Débito', 'T. Crédito', 'Cheque']

const ESTADOS = {
  pendiente: { l: 'Pendiente', c: '#FF9500', bg: '#FF950015', ic: '⏳' },
  validado:  { l: 'Validado',  c: '#34C759', bg: '#34C75915', ic: '✓' },
  rechazado: { l: 'Rechazado', c: '#FF3B30', bg: '#FF3B3015', ic: '✕' }
}

export function GmEditorMovimiento({ show, onClose, mov, cu, fondos, categorias, onGuardado }) {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [motivoRechazo, setMotivoRechazo] = useState('')
  const [showRechazo, setShowRechazo] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)

  useEffect(() => {
    if (mov) {
      setForm({
        id: mov.id,
        fondo_id: mov.fondo_id,
        fecha: mov.fecha,
        tipo: mov.tipo,
        proveedor: mov.proveedor || '',
        tipo_doc: mov.tipo_doc || 'Boleta',
        descripcion: mov.descripcion || '',
        categoria_id: mov.categoria_id || '',
        n_documento: mov.n_documento || '',
        responsable_nombre: mov.responsable_nombre || '',
        metodo_pago: mov.metodo_pago || 'Efectivo',
        monto: mov.monto,
        monto_original: mov.monto,
        tipo_original: mov.tipo,
        url_respaldo: mov.url_respaldo || '',
        archivo_storage: mov.archivo_storage || '',
        observaciones: mov.observaciones || '',
        estado: mov.estado || 'pendiente',
        afecta_saldo: mov.afecta_saldo !== false
      })
      setMotivoRechazo(mov.motivo_rechazo || '')
      setShowRechazo(false)
    }
  }, [mov])

  if (!form) return null

  const puedeValidar     = canSync(cu, 'finanzas', 'gm.validar') !== false
  const puedeEditarDoc   = canSync(cu, 'finanzas', 'gm.editar_doc') !== false
  const puedeEditarAll   = canSync(cu, 'finanzas', 'gm.editar_all') !== false
  const puedeEditarProp  = canSync(cu, 'finanzas', 'gm.editar_propio') !== false
  const esCreadorPropio  = mov?.created_by === cu?.id

  // Edición completa: solo admin (gm.editar_all) o creador propio si está pendiente
  const puedeEditarCampos = puedeEditarAll ||
    (puedeEditarProp && esCreadorPropio && form.estado === 'pendiente')

  // No se puede editar si está rechazado (cualquier rol)
  const bloqueadoTotal = form.estado === 'rechazado'

  const fondo = fondos.find(f => f.id === form.fondo_id)
  const estadoInfo = ESTADOS[form.estado] || ESTADOS.pendiente

  /* ─── Guardar cambios de campos ─── */
  const guardarCambios = async () => {
    if (!puedeEditarCampos) { toast.error('No tienes permiso para editar este movimiento'); return }
    if (!form.monto || Number(form.monto) <= 0) { toast.error('Monto inválido'); return }

    setSaving(true)
    try {
      const montoNuevo = Math.round(Number(form.monto))
      const tipoNuevo  = form.tipo

      // Si cambió monto o tipo, recalcular impacto en saldo del fondo
      let deltaAjuste = 0
      if (form.afecta_saldo) {
        const deltaOriginal = form.tipo_original === 'ingreso' ? form.monto_original : -form.monto_original
        const deltaNuevo    = tipoNuevo === 'ingreso' ? montoNuevo : -montoNuevo
        deltaAjuste = deltaNuevo - deltaOriginal
      }

      const updates = {
        fecha: form.fecha,
        tipo: tipoNuevo,
        proveedor: form.proveedor || null,
        tipo_doc: tipoNuevo === 'ingreso' ? 'Ingreso de dinero' : form.tipo_doc,
        descripcion: form.descripcion || null,
        categoria_id: tipoNuevo === 'gasto' ? (form.categoria_id || null) : null,
        n_documento: form.n_documento || null,
        responsable_nombre: form.responsable_nombre || null,
        metodo_pago: form.metodo_pago || null,
        monto: montoNuevo,
        url_respaldo: form.url_respaldo || null,
        observaciones: form.observaciones || null,
        updated_at: new Date().toISOString()
      }

      const { error: e1 } = await supabase.from('gm_movimientos').update(updates).eq('id', form.id)
      if (e1) throw e1

      if (deltaAjuste !== 0 && fondo) {
        const { error: e2 } = await supabase.from('gm_fondos')
          .update({ saldo_actual: (fondo.saldo_actual || 0) + deltaAjuste, updated_at: new Date().toISOString() })
          .eq('id', fondo.id)
        if (e2) throw e2
      }

      toast.success('Cambios guardados')
      onGuardado && onGuardado()
      onClose()
    } catch (e) {
      console.error(e)
      toast.error('Error al guardar: ' + (e.message || 'desconocido'))
    } finally {
      setSaving(false)
    }
  }

  /* ─── Validar movimiento ─── */
  const validar = async () => {
    if (!puedeValidar) { toast.error('No tienes permiso para validar'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('gm_movimientos').update({
        estado: 'validado',
        validado_por: cu?.id,
        validado_at: new Date().toISOString(),
        motivo_rechazo: null,
        updated_at: new Date().toISOString()
      }).eq('id', form.id)
      if (error) throw error

      // Si venía de rechazado, hay que volver a afectar el saldo
      if (form.estado === 'rechazado' && !form.afecta_saldo && fondo) {
        const delta = form.tipo === 'ingreso' ? form.monto : -form.monto
        await supabase.from('gm_movimientos').update({ afecta_saldo: true }).eq('id', form.id)
        await supabase.from('gm_fondos')
          .update({ saldo_actual: (fondo.saldo_actual || 0) + delta, updated_at: new Date().toISOString() })
          .eq('id', fondo.id)
      }

      toast.success('Movimiento validado ✓')
      onGuardado && onGuardado()
      onClose()
    } catch (e) {
      console.error(e)
      toast.error('Error al validar: ' + (e.message || 'desconocido'))
    } finally {
      setSaving(false)
    }
  }

  /* ─── Rechazar movimiento (revierte saldo) ─── */
  const rechazar = async () => {
    if (!puedeValidar) { toast.error('No tienes permiso para rechazar'); return }
    if (!motivoRechazo.trim()) { toast.error('Indica el motivo del rechazo'); return }
    setSaving(true)
    try {
      // Revertir saldo si el movimiento estaba afectándolo
      if (form.afecta_saldo && fondo) {
        const deltaReverso = form.tipo === 'ingreso' ? -form.monto : form.monto
        const { error: e1 } = await supabase.from('gm_fondos')
          .update({ saldo_actual: (fondo.saldo_actual || 0) + deltaReverso, updated_at: new Date().toISOString() })
          .eq('id', fondo.id)
        if (e1) throw e1
      }

      const { error: e2 } = await supabase.from('gm_movimientos').update({
        estado: 'rechazado',
        validado_por: cu?.id,
        validado_at: new Date().toISOString(),
        motivo_rechazo: motivoRechazo.trim(),
        afecta_saldo: false,
        updated_at: new Date().toISOString()
      }).eq('id', form.id)
      if (e2) throw e2

      toast.success('Movimiento rechazado — saldo revertido')
      onGuardado && onGuardado()
      onClose()
    } catch (e) {
      console.error(e)
      toast.error('Error al rechazar: ' + (e.message || 'desconocido'))
    } finally {
      setSaving(false)
    }
  }

  /* ─── Upload de archivo a Storage ─── */
  const subirArchivo = async (file) => {
    if (!file) return
    if (!puedeEditarDoc) { toast.error('No tienes permiso para subir archivos'); return }
    if (file.size > 5 * 1024 * 1024) { toast.error('Archivo muy grande (máx. 5MB)'); return }

    setUploadingFile(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `${fondo?.sucursal_id || 'misc'}/${form.id}.${ext}`

      // Borrar archivo anterior si existe
      if (form.archivo_storage) {
        await supabase.storage.from('gastos-menores').remove([form.archivo_storage])
      }

      const { error: upErr } = await supabase.storage.from('gastos-menores')
        .upload(path, file, { upsert: true, cacheControl: '3600' })
      if (upErr) throw upErr

      const { error: dbErr } = await supabase.from('gm_movimientos')
        .update({ archivo_storage: path, updated_at: new Date().toISOString() })
        .eq('id', form.id)
      if (dbErr) throw dbErr

      setForm({ ...form, archivo_storage: path })
      toast.success('Archivo adjuntado')
      onGuardado && onGuardado()
    } catch (e) {
      console.error(e)
      toast.error('Error al subir: ' + (e.message || 'desconocido'))
    } finally {
      setUploadingFile(false)
    }
  }

  const eliminarArchivo = async () => {
    if (!form.archivo_storage) return
    if (!confirm('¿Eliminar el archivo adjunto?')) return
    setUploadingFile(true)
    try {
      await supabase.storage.from('gastos-menores').remove([form.archivo_storage])
      await supabase.from('gm_movimientos')
        .update({ archivo_storage: null, updated_at: new Date().toISOString() })
        .eq('id', form.id)
      setForm({ ...form, archivo_storage: '' })
      toast.success('Archivo eliminado')
      onGuardado && onGuardado()
    } catch (e) {
      console.error(e)
      toast.error('Error: ' + (e.message || 'desconocido'))
    } finally {
      setUploadingFile(false)
    }
  }

  const verArchivo = async () => {
    if (!form.archivo_storage) return
    try {
      const { data, error } = await supabase.storage.from('gastos-menores')
        .createSignedUrl(form.archivo_storage, 300) // 5 min
      if (error) throw error
      window.open(data.signedUrl, '_blank')
    } catch (e) {
      toast.error('Error al abrir archivo')
    }
  }

  return (
    <Sheet show={show} onClose={onClose} title={`Movimiento ${form.fecha}`}>
      {/* Banner de estado */}
      <div style={{
        padding: 12, borderRadius: 10, marginBottom: 14,
        background: estadoInfo.bg, border: `1px solid ${estadoInfo.c}30`,
        display: "flex", justifyContent: "space-between", alignItems: "center"
      }}>
        <div>
          <div style={{ fontSize: 11, color: "#8E8E93", fontWeight: 600, marginBottom: 2 }}>Estado</div>
          <Bd c={estadoInfo.c} bg={estadoInfo.bg} lg>{estadoInfo.ic} {estadoInfo.l}</Bd>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#8E8E93" }}>{form.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: form.tipo === 'ingreso' ? "#34C759" : "#FF3B30" }}>
            {form.tipo === 'ingreso' ? '+' : '−'} {fmt(Math.abs(form.monto))}
          </div>
        </div>
      </div>

      {/* Si está rechazado, mostrar motivo */}
      {form.estado === 'rechazado' && form.motivo_rechazo && (
        <div style={{
          padding: 10, borderRadius: 8, marginBottom: 12,
          background: "#FF3B3008", borderLeft: "3px solid #FF3B30"
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#FF3B30" }}>Motivo del rechazo</div>
          <div style={{ fontSize: 13, marginTop: 2 }}>{form.motivo_rechazo}</div>
        </div>
      )}

      {/* Campos editables */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Fl l="Fecha">
          <input type="date" value={form.fecha}
                 onChange={e => setForm({...form, fecha: e.target.value})}
                 disabled={!puedeEditarCampos || bloqueadoTotal} style={css.input} />
        </Fl>
        <Fl l="Tipo">
          <select value={form.tipo} onChange={e => setForm({...form, tipo: e.target.value})}
                  disabled={!puedeEditarCampos || bloqueadoTotal} style={css.select}>
            <option value="gasto">Gasto</option>
            <option value="ingreso">Ingreso</option>
          </select>
        </Fl>
        <Fl l="Monto (CLP)">
          <input type="number" value={form.monto}
                 onChange={e => setForm({...form, monto: e.target.value})}
                 disabled={!puedeEditarCampos || bloqueadoTotal} style={css.input} />
        </Fl>
        <Fl l="Tipo doc.">
          <select value={form.tipo_doc} onChange={e => setForm({...form, tipo_doc: e.target.value})}
                  disabled={!puedeEditarCampos || bloqueadoTotal} style={css.select}>
            {TIPOS_DOC.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Fl>
        <Fl l="Proveedor">
          <input value={form.proveedor} onChange={e => setForm({...form, proveedor: e.target.value})}
                 disabled={!puedeEditarCampos || bloqueadoTotal} style={css.input} />
        </Fl>
        <Fl l="N° documento">
          <input value={form.n_documento} onChange={e => setForm({...form, n_documento: e.target.value})}
                 disabled={!puedeEditarCampos || bloqueadoTotal} style={css.input} />
        </Fl>
        {form.tipo === 'gasto' && (
          <Fl l="Categoría">
            <select value={form.categoria_id} onChange={e => setForm({...form, categoria_id: e.target.value})}
                    disabled={!puedeEditarCampos || bloqueadoTotal} style={css.select}>
              <option value="">—</option>
              {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Fl>
        )}
        <Fl l="Método de pago">
          <select value={form.metodo_pago} onChange={e => setForm({...form, metodo_pago: e.target.value})}
                  disabled={!puedeEditarCampos || bloqueadoTotal} style={css.select}>
            {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Fl>
        <Fl l="Responsable">
          <input value={form.responsable_nombre}
                 onChange={e => setForm({...form, responsable_nombre: e.target.value})}
                 disabled={!puedeEditarCampos || bloqueadoTotal} style={css.input} />
        </Fl>
        <div style={{ gridColumn: "1 / 3" }}>
          <Fl l="Descripción">
            <input value={form.descripcion} onChange={e => setForm({...form, descripcion: e.target.value})}
                   disabled={!puedeEditarCampos || bloqueadoTotal} style={css.input} />
          </Fl>
        </div>
        <div style={{ gridColumn: "1 / 3" }}>
          <Fl l="Observaciones">
            <input value={form.observaciones} onChange={e => setForm({...form, observaciones: e.target.value})}
                   disabled={!puedeEditarCampos || bloqueadoTotal} style={css.input} />
          </Fl>
        </div>
      </div>

      {/* Documento de respaldo */}
      <Cd>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>📎 Documento de respaldo</div>

        {/* URL externa */}
        <Fl l="URL externa (Drive, Dropbox...)">
          <input value={form.url_respaldo} onChange={e => setForm({...form, url_respaldo: e.target.value})}
                 placeholder="https://drive.google.com/..."
                 disabled={!puedeEditarDoc || bloqueadoTotal} style={css.input} />
        </Fl>

        {/* Archivo subido */}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#3A3A3C", marginBottom: 6 }}>
            Archivo adjunto
          </div>
          {form.archivo_storage ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: 10, borderRadius: 8, background: "#34C75910",
              border: "1px solid #34C75930"
            }}>
              <span style={{ fontSize: 20 }}>📄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{form.archivo_storage.split('/').pop()}</div>
                <div style={{ fontSize: 10, color: "#8E8E93" }}>{form.archivo_storage}</div>
              </div>
              <Bt v="secondary" sm onClick={verArchivo}>Ver</Bt>
              {puedeEditarDoc && !bloqueadoTotal && (
                <Bt v="secondary" sm onClick={eliminarArchivo} dis={uploadingFile}>✕</Bt>
              )}
            </div>
          ) : (
            <div>
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"
                     onChange={e => subirArchivo(e.target.files?.[0])}
                     disabled={!puedeEditarDoc || bloqueadoTotal || uploadingFile}
                     style={{ fontSize: 12 }} />
              {uploadingFile && <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 4 }}>Subiendo...</div>}
              <div style={{ fontSize: 10, color: "#8E8E93", marginTop: 4 }}>
                Formatos: PDF, PNG, JPG, WEBP — máx. 5MB
              </div>
            </div>
          )}
        </div>
      </Cd>

      {/* Modal de rechazo */}
      {showRechazo && (
        <Cd>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#FF3B30" }}>
            Motivo del rechazo
          </div>
          <textarea value={motivoRechazo} onChange={e => setMotivoRechazo(e.target.value)}
                    placeholder="Ej: Falta respaldo, gasto no autorizado, monto incorrecto..."
                    rows={3} style={{ ...css.input, resize: "vertical" }} />
          <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 6 }}>
            ⚠️ Al rechazar se revierte el impacto del movimiento en el saldo del fondo
            ({fmt(form.tipo === 'ingreso' ? -form.monto : form.monto)} {form.tipo === 'ingreso' ? 'descuento' : 'devolución'}).
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
            <Bt v="secondary" onClick={() => setShowRechazo(false)} dis={saving}>Cancelar</Bt>
            <Bt v="primary" onClick={rechazar} dis={saving || !motivoRechazo.trim()}
                style={{ background: "#FF3B30" }}>
              Confirmar rechazo
            </Bt>
          </div>
        </Cd>
      )}

      {/* Botones de acción */}
      <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <Bt v="secondary" onClick={onClose} dis={saving}>Cerrar</Bt>

        {puedeValidar && form.estado !== 'validado' && !showRechazo && (
          <Bt v="primary" onClick={validar} dis={saving} style={{ background: "#34C759" }}>
            ✓ Validar
          </Bt>
        )}
        {puedeValidar && form.estado !== 'rechazado' && !showRechazo && (
          <Bt v="secondary" onClick={() => setShowRechazo(true)} dis={saving}
              style={{ color: "#FF3B30", borderColor: "#FF3B3050" }}>
            ✕ Rechazar
          </Bt>
        )}
        {puedeEditarCampos && !bloqueadoTotal && !showRechazo && (
          <Bt v="primary" onClick={guardarCambios} dis={saving}>
            {saving ? "Guardando..." : "Guardar cambios"}
          </Bt>
        )}
      </div>

      {/* Footer info */}
      <div style={{ marginTop: 12, fontSize: 10, color: "#8E8E93", lineHeight: 1.5 }}>
        ID: {form.id} · Creado: {mov?.created_at?.slice(0, 16).replace('T', ' ')}
        {mov?.validado_at && <> · {form.estado === 'validado' ? 'Validado' : 'Procesado'}: {mov.validado_at.slice(0, 16).replace('T', ' ')}</>}
        {!form.afecta_saldo && <> · <span style={{ color: "#FF9500" }}>No afecta saldo</span></>}
      </div>
    </Sheet>
  )
}
