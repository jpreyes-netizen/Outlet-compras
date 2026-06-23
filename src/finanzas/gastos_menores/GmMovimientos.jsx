import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabase'
import { fmt, hoy } from '../../lib/constants'
import { canSync, userScopeSync } from '../../core/permisos'
import { Cd, Bd, Bt, Fl, Sheet, css } from '../../components/UI'
import { GmImportador } from './GmImportador'
import { GmEditorMovimiento } from './GmEditorMovimiento'
import { toast } from 'sonner'

const SUCURSALES = {
  'suc-la': { l: 'Los Ángeles', c: '#007AFF' },
  'suc-mp': { l: 'Maipú',       c: '#34C759' },
  'suc-lg': { l: 'La Granja',   c: '#FF9500' },
  'dir-adm': { l: 'Dir. Administración y Finanzas', c: '#AF52DE' },
  'dir-com': { l: 'Dir. Comercial',                  c: '#5856D6' },
  'dir-neg': { l: 'Dir. Negocios',                   c: '#FF3B30' },
  'dir-ops': { l: 'Dir. Operaciones',                c: '#5AC8FA' },
  'ops-lg':  { l: 'OPS · La Granja',                 c: '#5AC8FA' },
  'com-lg':  { l: 'COM · La Granja',                 c: '#5856D6' }
}
const TIPOS_DOC   = ['Boleta', 'Factura', 'Ticket', 'Guía', 'Comprobante', 'Otro']
const METODOS_PAGO = ['Efectivo', 'Transferencia', 'T. Débito', 'T. Crédito', 'Cheque']

const ESTADOS_BD = {
  pendiente: { l: 'Pendiente', c: '#FF9500', bg: '#FF950015', ic: '⏳' },
  validado:  { l: 'Validado',  c: '#34C759', bg: '#34C75915', ic: '✓' },
  rechazado: { l: 'Rechazado', c: '#FF3B30', bg: '#FF3B3015', ic: '✕' }
}

export function GmMovimientos({ cu, isMobile }) {
  const [loading, setLoading]   = useState(true)
  const [fondos, setFondos]     = useState([])
  const [categorias, setCats]   = useState([])
  const [movs, setMovs]         = useState([])
  const [filtroFondo, setFiltroFondo] = useState('todos')
  const [filtroTipo, setFiltroTipo]   = useState('todos')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [movEditando, setMovEditando] = useState(null)
  const [saving, setSaving]     = useState(false)

  // Formulario de alta
  const [form, setForm] = useState({
    fondo_id: '', fecha: hoy(), tipo: 'gasto',
    proveedor: '', tipo_doc: 'Boleta', descripcion: '',
    categoria_id: '', n_documento: '', responsable_nombre: '',
    metodo_pago: 'Efectivo', monto: '', url_respaldo: '', archivo_storage: '', observaciones: ''
  })
  const [uploadingNuevo, setUploadingNuevo] = useState(false)

  const cargar = async () => {
    setLoading(true)
    try {
      const [{ data: fs }, { data: cs }, { data: ms }] = await Promise.all([
        supabase.from('gm_fondos').select('id, sucursal_id, custodio_id, monto_asignado, saldo_actual, estado').eq('estado', 'activo'),
        supabase.from('gm_categorias').select('id, nombre, activo').eq('activo', true).order('orden'),
        supabase.from('gm_movimientos')
          .select('id, fondo_id, fecha, tipo, proveedor, tipo_doc, descripcion, categoria_id, n_documento, responsable_nombre, metodo_pago, monto, saldo_post, url_respaldo, archivo_storage, observaciones, origen, estado, validado_por, validado_at, motivo_rechazo, afecta_saldo, created_by, created_at, gm_categorias(nombre)')
          .order('fecha', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(500)
      ])
      // Filtrar fondos por scope del usuario (sucursal asignada en usuario_acceso)
      const miScope = userScopeSync(cu, 'finanzas', 'gm.movimientos', { raw: true })
      const fondosVisibles = (fs || []).filter(f => !miScope || f.sucursal_id === miScope)
      setFondos(fondosVisibles)
      setCats(cs || [])

      // Filtrar también movimientos a fondos visibles
      const fondosIdsVisibles = new Set(fondosVisibles.map(f => f.id))
      setMovs((ms || []).filter(m => fondosIdsVisibles.has(m.fondo_id)))

      // Default fondo_id en el form si solo hay uno o si hay uno de la sucursal del usuario
      if (!form.fondo_id && fondosVisibles.length > 0) {
        const mio = fondosVisibles.find(f => f.custodio_id === cu?.id)
        setForm(f => ({ ...f, fondo_id: mio?.id || fondosVisibles[0].id }))
      }
    } catch (e) {
      console.error('Error cargando movimientos:', e)
      toast.error('Error al cargar movimientos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const movsFiltrados = useMemo(() => {
    return movs.filter(m => {
      if (filtroFondo !== 'todos' && m.fondo_id !== filtroFondo) return false
      if (filtroTipo !== 'todos' && m.tipo !== filtroTipo) return false
      if (filtroEstado !== 'todos' && (m.estado || 'pendiente') !== filtroEstado) return false
      return true
    })
  }, [movs, filtroFondo, filtroTipo, filtroEstado])

  const totales = useMemo(() => {
    const ing = movsFiltrados.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0)
    const gas = movsFiltrados.filter(m => m.tipo === 'gasto').reduce((s, m) => s + (m.monto || 0), 0)
    return { ing, gas, neto: ing - gas, count: movsFiltrados.length }
  }, [movsFiltrados])

  const sucursalDeFondo = (fondoId) => {
    const f = fondos.find(x => x.id === fondoId)
    return f ? SUCURSALES[f.sucursal_id] : null
  }

  const subirArchivoNuevo = async (file) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { toast.error('Archivo muy grande (máx. 5MB)'); return }
    const fondo = fondos.find(f => f.id === form.fondo_id)
    if (!fondo) { toast.error('Selecciona un fondo primero'); return }
    setUploadingNuevo(true)
    try {
      // Eliminar archivo anterior si existe
      if (form.archivo_storage) {
        await supabase.storage.from('gastos-menores').remove([form.archivo_storage])
      }
      const ext = file.name.split('.').pop().toLowerCase()
      const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const path = `${fondo.sucursal_id}/new_${uid}.${ext}`
      const { error } = await supabase.storage.from('gastos-menores')
        .upload(path, file, { upsert: false, cacheControl: '3600' })
      if (error) throw error
      setForm(f => ({ ...f, archivo_storage: path }))
      toast.success('Archivo listo — se adjuntará al guardar')
    } catch (e) {
      console.error(e)
      toast.error('Error al subir: ' + (e.message || 'desconocido'))
    } finally {
      setUploadingNuevo(false)
    }
  }

  const validarForm = () => {
    if (!form.fondo_id) return 'Selecciona un fondo'
    if (!form.fecha)    return 'La fecha es obligatoria'
    if (!form.monto || Number(form.monto) <= 0) return 'Monto debe ser mayor a 0'
    if (form.tipo === 'gasto' && !form.descripcion) return 'La descripción es obligatoria'
    return null
  }

  const guardar = async () => {
    const err = validarForm()
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      const monto = Math.round(Number(form.monto))
      const fondo = fondos.find(f => f.id === form.fondo_id)
      if (!fondo) { toast.error('Fondo no encontrado'); setSaving(false); return }

      // Detectar si la fecha es retroactiva consultando la última fecha del fondo
      const { data: ultimo } = await supabase
        .from('gm_movimientos')
        .select('fecha')
        .eq('fondo_id', form.fondo_id)
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle()

      const fechaUltima = ultimo?.fecha || null
      const esRetroactivo = fechaUltima && form.fecha < fechaUltima

      // Calcular saldo_post provisional (lo recalculamos después si es retroactivo)
      const delta = form.tipo === 'ingreso' ? monto : -monto
      const saldoPostProvisional = (fondo.saldo_actual || 0) + delta

      // Insertar movimiento con saldo_post provisional
      const { data: inserted, error: e1 } = await supabase.from('gm_movimientos').insert({
        fondo_id: form.fondo_id,
        fecha: form.fecha,
        tipo: form.tipo,
        proveedor: form.proveedor || null,
        tipo_doc: form.tipo === 'ingreso' ? 'Ingreso de dinero' : form.tipo_doc,
        descripcion: form.descripcion || null,
        categoria_id: form.tipo === 'gasto' ? (form.categoria_id || null) : null,
        n_documento: form.n_documento || null,
        responsable_nombre: form.responsable_nombre || cu?.nombre || null,
        metodo_pago: form.metodo_pago || null,
        monto: monto,
        saldo_post: saldoPostProvisional,
        url_respaldo: form.url_respaldo || null,
        archivo_storage: form.archivo_storage || null,
        observaciones: form.observaciones || null,
        origen: 'manual',
        created_by: cu?.id || null
      }).select('id').single()
      if (e1) throw e1

      // Si hay archivo con path temporal, renombrar con el ID real del movimiento
      if (form.archivo_storage && inserted?.id) {
        const ext = form.archivo_storage.split('.').pop()
        const fondoRef = fondos.find(f => f.id === form.fondo_id)
        const newPath = `${fondoRef?.sucursal_id || 'misc'}/${inserted.id}.${ext}`
        try {
          await supabase.storage.from('gastos-menores').move(form.archivo_storage, newPath)
          await supabase.from('gm_movimientos')
            .update({ archivo_storage: newPath })
            .eq('id', inserted.id)
        } catch (moveErr) {
          console.warn('No se pudo renombrar archivo:', moveErr.message)
        }
      }

      let saldoFinal = saldoPostProvisional

      if (esRetroactivo) {
        // Recalcular cadena completa de saldos en orden cronológico
        const { data: todos, error: e3 } = await supabase
          .from('gm_movimientos')
          .select('id, fecha, tipo, monto, created_at')
          .eq('fondo_id', form.fondo_id)
          .order('fecha', { ascending: true })
          .order('created_at', { ascending: true })
        if (e3) throw e3

        let saldoAcum = 0
        const updates = (todos || []).map(m => {
          const d = m.tipo === 'ingreso' ? m.monto : -m.monto
          saldoAcum += d
          return { id: m.id, saldo_post: saldoAcum }
        })

        // Update en batches para no saturar
        for (const u of updates) {
          await supabase.from('gm_movimientos').update({ saldo_post: u.saldo_post }).eq('id', u.id)
        }
        saldoFinal = saldoAcum
        toast.info('Fecha retroactiva detectada — saldos recalculados', { duration: 3000 })
      } else if (saldoFinal < 0) {
        toast.warning(`Saldo quedará en ${fmt(saldoFinal)} — registro permitido`, { duration: 4000 })
      }

      // Actualizar saldo del fondo con el valor final
      const { error: e2 } = await supabase
        .from('gm_fondos')
        .update({ saldo_actual: saldoFinal, updated_at: new Date().toISOString() })
        .eq('id', form.fondo_id)
      if (e2) throw e2

      toast.success(`${form.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} registrado — ${fmt(monto)}`)
      setShowForm(false)
      // Reset form pero mantener fondo_id y fecha
      setForm(f => ({
        ...f, proveedor: '', descripcion: '', categoria_id: '',
        n_documento: '', monto: '', url_respaldo: '', archivo_storage: '', observaciones: ''
      }))
      cargar()
    } catch (e) {
      console.error(e)
      toast.error('Error al guardar: ' + (e.message || 'desconocido'))
    } finally {
      setSaving(false)
    }
  }

  const puedeRegistrar = canSync(cu, 'finanzas', 'gm.registrar') !== false

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#8E8E93" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
        <div>Cargando movimientos...</div>
      </div>
    )
  }

  return (
    <div>
      {/* Toolbar: filtros + botón nuevo */}
      <div style={{
        display: "flex", gap: 8, flexWrap: "wrap",
        alignItems: "center", marginBottom: 12,
        padding: 10, background: "#fff", borderRadius: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)"
      }}>
        <select value={filtroFondo} onChange={e => setFiltroFondo(e.target.value)}
                style={{ ...css.select, width: "auto", flex: isMobile ? "1 1 100%" : "0 1 auto" }}>
          <option value="todos">Todos los fondos</option>
          {fondos.map(f => {
            const suc = SUCURSALES[f.sucursal_id]
            return <option key={f.id} value={f.id}>{suc?.l || f.sucursal_id}</option>
          })}
        </select>
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
                style={{ ...css.select, width: "auto", flex: isMobile ? "1 1 100%" : "0 1 auto" }}>
          <option value="todos">Todos los tipos</option>
          <option value="ingreso">Solo ingresos</option>
          <option value="gasto">Solo gastos</option>
        </select>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
                style={{ ...css.select, width: "auto", flex: isMobile ? "1 1 100%" : "0 1 auto" }}>
          <option value="todos">Todos los estados</option>
          <option value="pendiente">⏳ Pendientes</option>
          <option value="validado">✓ Validados</option>
          <option value="rechazado">✕ Rechazados</option>
        </select>
        <div style={{ flex: 1 }} />
        {puedeRegistrar && (
          <>
            <Bt v="secondary" onClick={() => setShowImport(true)} ic="📥">Importar Excel</Bt>
            <Bt v="primary" onClick={() => setShowForm(true)} ic="+">Nuevo movimiento</Bt>
          </>
        )}
      </div>

      {/* Resumen del filtro */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <Bd c="#8E8E93" bg="#F2F2F7">{totales.count} movimientos</Bd>
        <Bd c="#34C759" bg="#34C75915">Ingresos: {fmt(totales.ing)}</Bd>
        <Bd c="#FF3B30" bg="#FF3B3015">Gastos: {fmt(totales.gas)}</Bd>
        <Bd c={totales.neto >= 0 ? "#34C759" : "#FF3B30"} bg={totales.neto >= 0 ? "#34C75915" : "#FF3B3015"}>
          Neto: {fmt(totales.neto)}
        </Bd>
      </div>

      {/* Tabla */}
      <Cd>
        {movsFiltrados.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#8E8E93" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📒</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Sin movimientos</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {puedeRegistrar ? 'Registra el primer movimiento con el botón "Nuevo movimiento"' : 'No tienes permisos para registrar'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#F2F2F7", borderBottom: "2px solid #E5E5EA" }}>
                  <th style={th}>Fecha</th>
                  <th style={th}>Sucursal</th>
                  <th style={th}>Tipo</th>
                  <th style={th}>Estado</th>
                  <th style={th}>Proveedor / Descripción</th>
                  <th style={th}>Categoría</th>
                  <th style={th}>Responsable</th>
                  <th style={{ ...th, textAlign: "right" }}>Monto</th>
                  <th style={{ ...th, textAlign: "right" }}>Saldo</th>
                  <th style={th}>Doc.</th>
                </tr>
              </thead>
              <tbody>
                {movsFiltrados.map(m => {
                  const suc = sucursalDeFondo(m.fondo_id)
                  const esIngreso = m.tipo === 'ingreso'
                  const est = ESTADOS_BD[m.estado || 'pendiente']
                  const rechazado = m.estado === 'rechazado'
                  return (
                    <tr key={m.id}
                        onClick={() => setMovEditando(m)}
                        style={{
                          borderBottom: "1px solid #F2F2F7",
                          cursor: "pointer",
                          opacity: rechazado ? 0.55 : 1,
                          textDecoration: rechazado ? "line-through" : "none"
                        }}
                        onMouseOver={e => { e.currentTarget.style.background = "#F8F8FA" }}
                        onMouseOut={e => { e.currentTarget.style.background = "transparent" }}>
                      <td style={td}>{m.fecha}</td>
                      <td style={td}>
                        {suc ? <Bd c={suc.c} bg={suc.c + "15"}>{suc.l}</Bd> : '—'}
                      </td>
                      <td style={td}>
                        <Bd c={esIngreso ? "#34C759" : "#FF3B30"} bg={esIngreso ? "#34C75915" : "#FF3B3015"}>
                          {esIngreso ? "↑ Ingreso" : "↓ Gasto"}
                        </Bd>
                      </td>
                      <td style={td}>
                        <Bd c={est.c} bg={est.bg}>{est.ic} {est.l}</Bd>
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 600, color: "#1C1C1E" }}>{m.proveedor || m.descripcion || '—'}</div>
                        {m.proveedor && m.descripcion && (
                          <div style={{ fontSize: 11, color: "#8E8E93" }}>{m.descripcion}</div>
                        )}
                      </td>
                      <td style={td}>{m.gm_categorias?.nombre || '—'}</td>
                      <td style={td}>{m.responsable_nombre || '—'}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, color: esIngreso ? "#34C759" : "#1C1C1E" }}>
                        {esIngreso ? '+' : '−'} {fmt(m.monto)}
                      </td>
                      <td style={{ ...td, textAlign: "right", color: m.saldo_post < 0 ? "#FF3B30" : "#8E8E93" }}>
                        {m.saldo_post != null ? fmt(m.saldo_post) : '—'}
                      </td>
                      <td style={td} onClick={e => e.stopPropagation()}>
                        {m.url_respaldo ? (
                          <a href={m.url_respaldo} target="_blank" rel="noreferrer"
                             style={{ color: "#007AFF", textDecoration: "none", fontSize: 16 }}>📎</a>
                        ) : m.archivo_storage ? (
                          <button onClick={async () => {
                            try {
                              const { data, error } = await supabase.storage
                                .from('gastos-menores')
                                .createSignedUrl(m.archivo_storage, 300)
                              if (error) throw error
                              window.open(data.signedUrl, '_blank')
                            } catch (e) {
                              toast.error('Error al abrir archivo')
                            }
                          }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#007AFF" }}>
                            📎
                          </button>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Cd>

      {/* Sheet — formulario de alta */}
      <Sheet show={showForm} onClose={() => setShowForm(false)} title="Nuevo movimiento">
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
          <Fl l="Fondo" req>
            <select value={form.fondo_id} onChange={e => setForm({ ...form, fondo_id: e.target.value })} style={css.select}>
              <option value="">— Selecciona —</option>
              {fondos.map(f => {
                const suc = SUCURSALES[f.sucursal_id]
                return <option key={f.id} value={f.id}>{suc?.l || f.sucursal_id} ({fmt(f.saldo_actual)})</option>
              })}
            </select>
          </Fl>
          <Fl l="Fecha" req>
            <input type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} style={css.input} />
          </Fl>
          <Fl l="Tipo" req>
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })} style={css.select}>
              <option value="gasto">Gasto</option>
              <option value="ingreso">Ingreso de dinero (reposición)</option>
            </select>
          </Fl>
          <Fl l="Monto (CLP)" req>
            <input type="number" min="0" step="1" value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })}
                   placeholder="0" style={css.input} />
          </Fl>
          {form.tipo === 'gasto' && (
            <>
              <Fl l="Proveedor">
                <input value={form.proveedor} onChange={e => setForm({ ...form, proveedor: e.target.value })}
                       placeholder="Ej: LIQUIMAX, KLERGAS..." style={css.input} />
              </Fl>
              <Fl l="Tipo documento">
                <select value={form.tipo_doc} onChange={e => setForm({ ...form, tipo_doc: e.target.value })} style={css.select}>
                  {TIPOS_DOC.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Fl>
              <Fl l="Categoría">
                <select value={form.categoria_id} onChange={e => setForm({ ...form, categoria_id: e.target.value })} style={css.select}>
                  <option value="">— Selecciona —</option>
                  {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </Fl>
              <Fl l="N° documento">
                <input value={form.n_documento} onChange={e => setForm({ ...form, n_documento: e.target.value })}
                       placeholder="Ej: 25857130" style={css.input} />
              </Fl>
            </>
          )}
          <Fl l="Responsable / comprador">
            <input value={form.responsable_nombre} onChange={e => setForm({ ...form, responsable_nombre: e.target.value })}
                   placeholder={cu?.nombre} style={css.input} />
          </Fl>
          <Fl l="Método de pago">
            <select value={form.metodo_pago} onChange={e => setForm({ ...form, metodo_pago: e.target.value })} style={css.select}>
              {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </Fl>
          <div style={{ gridColumn: isMobile ? "1" : "1 / 3" }}>
            <Fl l="Descripción del gasto" req={form.tipo === 'gasto'}>
              <input value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })}
                     placeholder="Ej: CONSUMO DE DINERO, peaje, gas..." style={css.input} />
            </Fl>
          </div>
          <div style={{ gridColumn: isMobile ? "1" : "1 / 3" }}>
            <Fl l="Documento de respaldo">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {/* URL externa */}
                <input value={form.url_respaldo} onChange={e => setForm({ ...form, url_respaldo: e.target.value })}
                       placeholder="URL Drive / Dropbox (https://...)" style={css.input} />
                {/* Separador */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 1, background: "#E5E5EA" }} />
                  <span style={{ fontSize: 11, color: "#8E8E93" }}>o sube un archivo</span>
                  <div style={{ flex: 1, height: 1, background: "#E5E5EA" }} />
                </div>
                {/* Uploader */}
                {form.archivo_storage ? (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 12px", borderRadius: 8,
                    background: "#34C75910", border: "1px solid #34C75930"
                  }}>
                    <span style={{ fontSize: 16 }}>📄</span>
                    <div style={{ flex: 1, fontSize: 11, color: "#34C759", fontWeight: 600 }}>
                      {form.archivo_storage.split('/').pop()}
                    </div>
                    <button onClick={() => setForm(f => ({ ...f, archivo_storage: '' }))}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#FF3B30", fontSize: 14 }}>✕</button>
                  </div>
                ) : (
                  <div>
                    <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp"
                           onChange={e => subirArchivoNuevo(e.target.files?.[0])}
                           disabled={uploadingNuevo || !form.fondo_id}
                           style={{ fontSize: 12 }} />
                    {uploadingNuevo && <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 4 }}>Subiendo...</div>}
                    {!form.fondo_id && <div style={{ fontSize: 10, color: "#FF9500", marginTop: 4 }}>Selecciona un fondo primero</div>}
                    <div style={{ fontSize: 10, color: "#8E8E93", marginTop: 2 }}>PDF, PNG, JPG, WEBP — máx. 5MB</div>
                  </div>
                )}
              </div>
            </Fl>
          </div>
          <div style={{ gridColumn: isMobile ? "1" : "1 / 3" }}>
            <Fl l="Observaciones">
              <input value={form.observaciones} onChange={e => setForm({ ...form, observaciones: e.target.value })}
                     placeholder="Notas adicionales..." style={css.input} />
            </Fl>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <Bt v="secondary" onClick={() => setShowForm(false)} dis={saving}>Cancelar</Bt>
          <Bt v="primary" onClick={guardar} dis={saving}>{saving ? "Guardando..." : "Guardar"}</Bt>
        </div>
      </Sheet>

      {/* Importador masivo */}
      <GmImportador
        show={showImport}
        onClose={() => setShowImport(false)}
        cu={cu}
        fondos={fondos}
        categorias={categorias}
        onImportado={() => { cargar() }}
      />

      {/* Editor de movimiento existente */}
      <GmEditorMovimiento
        show={!!movEditando}
        onClose={() => setMovEditando(null)}
        mov={movEditando}
        cu={cu}
        fondos={fondos}
        categorias={categorias}
        onGuardado={() => { cargar() }}
      />
    </div>
  )
}

const th = { padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#3A3A3C", textTransform: "uppercase", letterSpacing: "0.03em" }
const td = { padding: "10px 12px", fontSize: 13, color: "#1C1C1E", verticalAlign: "top" }
