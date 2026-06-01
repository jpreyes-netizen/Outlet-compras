import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabase'
import { fmt, hoy } from '../../lib/constants'
import { canSync } from '../../core/permisos'
import { Cd, Bd, Bt, Fl, Sheet, css } from '../../components/UI'
import { GmImportador } from './GmImportador'
import { toast } from 'sonner'

const SUCURSALES = {
  'suc-la': { l: 'Los Ángeles', c: '#007AFF' },
  'suc-mp': { l: 'Maipú',       c: '#34C759' },
  'suc-lg': { l: 'La Granja',   c: '#FF9500' }
}
const TIPOS_DOC   = ['Boleta', 'Factura', 'Ticket', 'Guía', 'Otro']
const METODOS_PAGO = ['Efectivo', 'Transferencia', 'T. Débito', 'T. Crédito', 'Cheque']

export function GmMovimientos({ cu, isMobile }) {
  const [loading, setLoading]   = useState(true)
  const [fondos, setFondos]     = useState([])
  const [categorias, setCats]   = useState([])
  const [movs, setMovs]         = useState([])
  const [filtroFondo, setFiltroFondo] = useState('todos')
  const [filtroTipo, setFiltroTipo]   = useState('todos')
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [saving, setSaving]     = useState(false)

  // Formulario de alta
  const [form, setForm] = useState({
    fondo_id: '', fecha: hoy(), tipo: 'gasto',
    proveedor: '', tipo_doc: 'Boleta', descripcion: '',
    categoria_id: '', n_documento: '', responsable_nombre: '',
    metodo_pago: 'Efectivo', monto: '', url_respaldo: '', observaciones: ''
  })

  const cargar = async () => {
    setLoading(true)
    try {
      const [{ data: fs }, { data: cs }, { data: ms }] = await Promise.all([
        supabase.from('gm_fondos').select('id, sucursal_id, custodio_id, monto_asignado, saldo_actual, estado').eq('estado', 'activo'),
        supabase.from('gm_categorias').select('id, nombre, activo').eq('activo', true).order('orden'),
        supabase.from('gm_movimientos')
          .select('id, fondo_id, fecha, tipo, proveedor, tipo_doc, descripcion, categoria_id, n_documento, responsable_nombre, metodo_pago, monto, saldo_post, url_respaldo, observaciones, origen, gm_categorias(nombre)')
          .order('fecha', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(500)
      ])
      setFondos(fs || [])
      setCats(cs || [])
      setMovs(ms || [])

      // Default fondo_id en el form si solo hay uno o si hay uno de la sucursal del usuario
      if (!form.fondo_id && fs && fs.length > 0) {
        const mio = fs.find(f => f.custodio_id === cu?.id)
        setForm(f => ({ ...f, fondo_id: mio?.id || fs[0].id }))
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
      return true
    })
  }, [movs, filtroFondo, filtroTipo])

  const totales = useMemo(() => {
    const ing = movsFiltrados.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0)
    const gas = movsFiltrados.filter(m => m.tipo === 'gasto').reduce((s, m) => s + (m.monto || 0), 0)
    return { ing, gas, neto: ing - gas, count: movsFiltrados.length }
  }, [movsFiltrados])

  const sucursalDeFondo = (fondoId) => {
    const f = fondos.find(x => x.id === fondoId)
    return f ? SUCURSALES[f.sucursal_id] : null
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

      // Calcular saldo post (suma/resta sobre saldo actual del fondo)
      const delta = form.tipo === 'ingreso' ? monto : -monto
      const saldoPost = (fondo.saldo_actual || 0) + delta

      // Alerta si queda negativo (no bloquea, solo avisa)
      if (saldoPost < 0) {
        toast.warning(`Saldo quedará en ${fmt(saldoPost)} — registro permitido`, { duration: 4000 })
      }

      // Insertar movimiento
      const { error: e1 } = await supabase.from('gm_movimientos').insert({
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
        saldo_post: saldoPost,
        url_respaldo: form.url_respaldo || null,
        observaciones: form.observaciones || null,
        origen: 'manual',
        created_by: cu?.id || null
      })
      if (e1) throw e1

      // Actualizar saldo del fondo
      const { error: e2 } = await supabase
        .from('gm_fondos')
        .update({ saldo_actual: saldoPost, updated_at: new Date().toISOString() })
        .eq('id', form.fondo_id)
      if (e2) throw e2

      toast.success(`${form.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} registrado — ${fmt(monto)}`)
      setShowForm(false)
      // Reset form pero mantener fondo_id y fecha
      setForm(f => ({
        ...f, proveedor: '', descripcion: '', categoria_id: '',
        n_documento: '', monto: '', url_respaldo: '', observaciones: ''
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
                  return (
                    <tr key={m.id} style={{ borderBottom: "1px solid #F2F2F7" }}>
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
                      <td style={td}>
                        {m.url_respaldo ? (
                          <a href={m.url_respaldo} target="_blank" rel="noreferrer" style={{ color: "#007AFF", textDecoration: "none" }}>📎</a>
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
            <Fl l="URL respaldo (Drive)">
              <input value={form.url_respaldo} onChange={e => setForm({ ...form, url_respaldo: e.target.value })}
                     placeholder="https://drive.google.com/..." style={css.input} />
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
    </div>
  )
}

const th = { padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#3A3A3C", textTransform: "uppercase", letterSpacing: "0.03em" }
const td = { padding: "10px 12px", fontSize: 13, color: "#1C1C1E", verticalAlign: "top" }
