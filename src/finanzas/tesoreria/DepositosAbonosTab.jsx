import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Paperclip, FileCheck, Loader2 } from 'lucide-react'
import { supabase } from '../../supabase'
import {
  formatCLP, parseCLP, rangoMes,
  inputSt, selectSt, labelSt, cardSt, btnSt, btnOutlineSt, TH, TD,
} from './types'
import { fetchDepositosEfectivo, fetchAbonos, fetchSucursales, insertGenerico } from './api'

const PUEDE_ESCRIBIR = ['admin', 'contabilidad', 'jefe_admin_finanzas', 'gerente_admin_finanzas', 'admin_sistema']
const TIPOS_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']
const MAX_BYTES = 5 * 1024 * 1024

function validarComprobante(file) {
  if (!TIPOS_PERMITIDOS.includes(file.type)) throw new Error('Formato no permitido. Solo PDF, JPG o PNG')
  if (file.size > MAX_BYTES) throw new Error('El archivo supera los 5MB')
}

async function subirComprobante(file, sucursalId, depositoId) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${sucursalId}/${depositoId}/${safeName}`
  const { error } = await supabase.storage.from('comprobantes-depositos').upload(path, file, { upsert: true, contentType: file.type })
  if (error) throw error
  return path
}

function MoneyInput({ value, onChange, disabled }) {
  const [text, setText] = useState(value ? formatCLP(value) : '')
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(value ? formatCLP(value) : '') }, [value, focused])
  return (
    <input type="text" inputMode="numeric" disabled={disabled} placeholder="$0" value={text}
      style={{ ...inputSt, textAlign: 'right', background: disabled ? '#F9FAFB' : '#fff' }}
      onFocus={e => { setFocused(true); setText(value ? String(value) : ''); setTimeout(() => e.target.select(), 0) }}
      onChange={e => { setText(e.target.value); onChange(parseCLP(e.target.value)) }}
      onBlur={() => { setFocused(false); setText(value ? formatCLP(value) : '') }}
    />
  )
}

function KpiMini({ title, value }) {
  return (
    <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '8px 12px', border: '1px solid #F3F4F6' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', color: '#9CA3AF', letterSpacing: '0.05em' }}>{title}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginTop: 2 }}>{value}</div>
    </div>
  )
}

function ComprobanteCell({ depositoId, sucursalId, comprobanteUrl, comprobanteNombre, onUpdated }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  async function abrirComprobante() {
    if (!comprobanteUrl) return
    try {
      let path = comprobanteUrl
      const marker = '/comprobantes-depositos/'
      const idx = comprobanteUrl.indexOf(marker)
      if (idx >= 0) path = comprobanteUrl.substring(idx + marker.length)
      const { data, error } = await supabase.storage.from('comprobantes-depositos').createSignedUrl(path, 60)
      if (error) throw error
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo abrir') }
  }

  async function onFileChange(e) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    try { validarComprobante(file) } catch (e) { toast.error(e.message); return }
    setUploading(true)
    try {
      const path = await subirComprobante(file, sucursalId, depositoId)
      const { error } = await supabase.from('depositos_efectivo').update({ comprobante_url: path, comprobante_nombre: file.name }).eq('id', depositoId)
      if (error) throw error
      toast.success('Comprobante adjuntado')
      onUpdated()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error al subir') }
    finally { setUploading(false) }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={onFileChange} />
      {comprobanteUrl ? (
        <button onClick={abrirComprobante} title={comprobanteNombre ?? 'Ver comprobante'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#16A34A', display: 'inline-flex', alignItems: 'center' }}>
          <FileCheck size={16} />
        </button>
      ) : (
        <button onClick={() => inputRef.current?.click()} disabled={uploading}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', display: 'inline-flex', alignItems: 'center' }}>
          <Paperclip size={16} />
        </button>
      )}
    </>
  )
}

function SeccionDeposito({ tipo, titulo, sucursalEf, desde, hasta, puedeEscribir, sucursales }) {
  const [filas, setFilas] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const formFileRef = useRef(null)
  const now = new Date()
  const [form, setForm] = useState({ sucursal_id: sucursalEf ?? '', fecha: hasta, monto: 0, banco: '', n_comprobante: '', observacion: '', comprobanteFile: null })

  const montoKey = tipo === 'depositos_efectivo' ? 'monto_depositado' : tipo === 'abonos_getnet' ? 'total_abono' : 'deposito_transbank'
  const total = filas.reduce((s, r) => s + Number(r[montoKey] ?? 0), 0)

  useEffect(() => {
    setLoading(true)
    const fn = tipo === 'depositos_efectivo'
      ? fetchDepositosEfectivo({ sucursal_id: sucursalEf, desde, hasta })
      : fetchAbonos(tipo, { sucursal_id: sucursalEf, desde, hasta })
    fn.then(setFilas).catch(e => toast.error(e.message)).finally(() => setLoading(false))
  }, [tipo, sucursalEf, desde, hasta])

  async function handleGuardar() {
    if (!form.sucursal_id) { toast.error('Selecciona sucursal'); return }
    if (form.monto <= 0) { toast.error('Monto debe ser mayor a 0'); return }
    setSaving(true)
    try {
      if (form.comprobanteFile) validarComprobante(form.comprobanteFile)
      const payload = { sucursal_id: form.sucursal_id, fecha: form.fecha, n_comprobante: form.n_comprobante || null }
      if (tipo === 'depositos_efectivo') { payload.monto_depositado = form.monto; payload.banco = form.banco || null; payload.observacion = form.observacion || null }
      else if (tipo === 'abonos_getnet') payload.total_abono = form.monto
      else payload.deposito_transbank = form.monto

      if (tipo === 'depositos_efectivo' && form.comprobanteFile) {
        const uid = (await supabase.auth.getSession()).data.session?.user.id
        const row = uid ? { ...payload, registrado_por: uid } : payload
        const { data, error } = await supabase.from('depositos_efectivo').insert(row).select('id').single()
        if (error) throw error
        const path = await subirComprobante(form.comprobanteFile, form.sucursal_id, String(data.id))
        await supabase.from('depositos_efectivo').update({ comprobante_url: path, comprobante_nombre: form.comprobanteFile.name }).eq('id', data.id)
      } else {
        await insertGenerico(tipo, payload)
      }
      toast.success('Registro agregado')
      setOpen(false)
      setForm({ sucursal_id: sucursalEf ?? '', fecha: hasta, monto: 0, banco: '', n_comprobante: '', observacion: '', comprobanteFile: null })
      // recargar
      const fn = tipo === 'depositos_efectivo' ? fetchDepositosEfectivo({ sucursal_id: sucursalEf, desde, hasta }) : fetchAbonos(tipo, { sucursal_id: sucursalEf, desde, hasta })
      fn.then(setFilas).catch(() => {})
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error') }
    finally { setSaving(false) }
  }

  return (
    <div style={cardSt}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{titulo}</div>
        {puedeEscribir && (
          <button onClick={() => setOpen(true)} style={{ ...btnSt(), padding: '5px 12px', fontSize: 12 }}>
            <Plus size={13} /> Registrar
          </button>
        )}
      </div>

      {/* KPIs mini */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        <KpiMini title="Total mes" value={formatCLP(total)} />
        <KpiMini title="Movimientos" value={String(filas.length)} />
        <KpiMini title="Último" value={filas.length > 0 ? String(filas[0].fecha ?? '—') : '—'} />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}><Loader2 size={20} style={{ display: 'inline-block', color: '#9CA3AF' }} /></div>
      ) : filas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 0', color: '#9CA3AF', fontSize: 13 }}>Sin movimientos</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Fecha</th>
                <th style={TH}>Sucursal</th>
                <th style={{ ...TH, textAlign: 'right' }}>Monto</th>
                {tipo === 'depositos_efectivo' && <th style={TH}>Banco</th>}
                <th style={TH}>N° comprob.</th>
                {tipo === 'depositos_efectivo' && <th style={{ ...TH, textAlign: 'center' }}>Adjunto</th>}
              </tr>
            </thead>
            <tbody>
              {filas.map((r, i) => {
                const sucName = sucursales.find(s => s.id === r.sucursal_id)?.nombre ?? '—'
                return (
                  <tr key={r.id ?? i} style={{ borderTop: '1px solid #F3F4F6' }}>
                    <td style={TD}>{String(r.fecha ?? '—')}</td>
                    <td style={TD}>{sucName}</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{formatCLP(Number(r[montoKey] ?? 0))}</td>
                    {tipo === 'depositos_efectivo' && <td style={TD}>{String(r.banco ?? '—')}</td>}
                    <td style={TD}>{String(r.n_comprobante ?? '—')}</td>
                    {tipo === 'depositos_efectivo' && (
                      <td style={{ ...TD, textAlign: 'center' }}>
                        <ComprobanteCell
                          depositoId={String(r.id ?? '')} sucursalId={String(r.sucursal_id ?? '')}
                          comprobanteUrl={r.comprobante_url ?? null} comprobanteNombre={r.comprobante_nombre ?? null}
                          onUpdated={() => fetchDepositosEfectivo({ sucursal_id: sucursalEf, desde, hasta }).then(setFilas).catch(() => {})}
                        />
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal nuevo registro */}
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, maxWidth: 440, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Nuevo registro — {titulo}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={labelSt}>Sucursal</label>
                <select style={selectSt} value={form.sucursal_id} onChange={e => setForm(p => ({ ...p, sucursal_id: e.target.value }))}>
                  <option value="">Selecciona…</option>
                  {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelSt}>Fecha</label>
                  <input type="date" style={inputSt} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
                </div>
                <div>
                  <label style={labelSt}>Monto</label>
                  <MoneyInput value={form.monto} onChange={n => setForm(p => ({ ...p, monto: n }))} />
                </div>
              </div>
              {tipo === 'depositos_efectivo' && (
                <div>
                  <label style={labelSt}>Banco</label>
                  <input style={inputSt} value={form.banco} onChange={e => setForm(p => ({ ...p, banco: e.target.value }))} />
                </div>
              )}
              <div>
                <label style={labelSt}>N° comprobante</label>
                <input style={inputSt} value={form.n_comprobante} onChange={e => setForm(p => ({ ...p, n_comprobante: e.target.value }))} />
              </div>
              {tipo === 'depositos_efectivo' && (
                <div>
                  <label style={labelSt}>Observación</label>
                  <input style={inputSt} value={form.observacion} onChange={e => setForm(p => ({ ...p, observacion: e.target.value }))} />
                </div>
              )}
              {tipo === 'depositos_efectivo' && (
                <div>
                  <label style={labelSt}>Comprobante</label>
                  <input ref={formFileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0] ?? null; e.target.value = ''
                      if (!file) return
                      try { validarComprobante(file); setForm(p => ({ ...p, comprobanteFile: file })) }
                      catch (err) { toast.error(err instanceof Error ? err.message : 'Archivo no válido') }
                    }} />
                  <button type="button" onClick={() => formFileRef.current?.click()}
                    style={{ ...btnOutlineSt, width: '100%', justifyContent: 'flex-start', fontSize: 12 }}>
                    <Paperclip size={13} />
                    {form.comprobanteFile ? form.comprobanteFile.name : 'Adjuntar comprobante'}
                  </button>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setOpen(false)} style={btnOutlineSt}>Cancelar</button>
              <button onClick={handleGuardar} disabled={saving} style={{ ...btnSt(), opacity: saving ? 0.6 : 1 }}>
                {saving && <Loader2 size={13} />} Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function DepositosAbonosTab({ usuario }) {
  const now = new Date()
  const [anio, setAnio] = useState(now.getFullYear())
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [sucursales, setSucursales] = useState([])
  const puedeElegirSuc = PUEDE_ESCRIBIR.includes(usuario.rol) || usuario.rol === 'gerencia'
  const [sucursal, setSucursal] = useState(puedeElegirSuc ? 'all' : (usuario.sucursal_id ?? ''))
  const [tabActivo, setTabActivo] = useState('efectivo')
  const sucursalEf = sucursal === 'all' ? null : sucursal || null
  const puedeEscribir = PUEDE_ESCRIBIR.includes(usuario.rol)
  const { desde, hasta } = rangoMes(anio, mes)
  const anios = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

  useEffect(() => { fetchSucursales().then(setSucursales).catch(() => {}) }, [])

  const tabs = [
    { k: 'efectivo', l: 'Depósitos efectivo', tipo: 'depositos_efectivo' },
    { k: 'getnet', l: 'Abonos Getnet', tipo: 'abonos_getnet' },
    { k: 'webpay', l: 'Abonos Webpay', tipo: 'abonos_webpay' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filtros */}
      <div style={cardSt}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <div>
            <label style={labelSt}>Año</label>
            <select style={selectSt} value={String(anio)} onChange={e => setAnio(Number(e.target.value))}>
              {anios.map(a => <option key={a} value={String(a)}>{a}</option>)}
            </select>
          </div>
          <div>
            <label style={labelSt}>Mes</label>
            <select style={selectSt} value={String(mes)} onChange={e => setMes(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={String(m)}>{String(m).padStart(2, '0')}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelSt}>Sucursal</label>
            <select style={selectSt} value={sucursal} disabled={!puedeElegirSuc} onChange={e => setSucursal(e.target.value)}>
              {puedeElegirSuc && <option value="all">Todas</option>}
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #E5E7EB' }}>
        {tabs.map(t => (
          <button key={t.k} onClick={() => setTabActivo(t.k)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer',
            color: tabActivo === t.k ? '#1F4E79' : '#6B7280',
            borderBottom: tabActivo === t.k ? '2px solid #1F4E79' : '2px solid transparent',
          }}>{t.l}</button>
        ))}
      </div>

      {tabs.filter(t => t.k === tabActivo).map(t => (
        <SeccionDeposito key={t.k} tipo={t.tipo} titulo={t.l}
          sucursalEf={sucursalEf} desde={desde} hasta={hasta}
          puedeEscribir={puedeEscribir} sucursales={sucursales} />
      ))}
    </div>
  )
}
