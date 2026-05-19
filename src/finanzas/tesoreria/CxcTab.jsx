import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { formatCLP, cardSt, selectSt, labelSt, btnSt, btnOutlineSt, TH, TD } from './types'
import { fetchSucursales, fetchSaldosClientes, fetchMovimientosCxc, fetchCuadraturasAnio, insertMovimientoCxc } from './api'

const PUEDE_TODO = ['admin', 'contabilidad', 'jefe_admin_finanzas', 'gerente_admin_finanzas', 'gerencia', 'admin_sistema']
const MESES = ['—','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const fmt = n => formatCLP(n ?? 0)

// ── Fila expandible de cliente ──────────────────────────────────────────────
function FilaCliente({ fila, sucursales }) {
  const [open, setOpen] = useState(false)
  const [movs, setMovs]     = useState([])
  const [loading, setLoading] = useState(false)

  async function cargar() {
    if (movs.length) { setOpen(v => !v); return }
    setLoading(true)
    setOpen(true)
    try {
      const data = await fetchMovimientosCxc({ cliente_rut: fila.cliente_rut, sucursal_id: fila.sucursal_id })
      setMovs(data)
    } catch { toast.error('Error al cargar movimientos') }
    finally { setLoading(false) }
  }

  const suc = sucursales.find(s => s.id === fila.sucursal_id)
  const saldo = Number(fila.saldo_actual ?? 0)

  return (
    <>
      <tr style={{ borderTop: '1px solid #F3F4F6', cursor: 'pointer', background: open ? '#F9FAFB' : 'transparent' }}
        onClick={cargar}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = '#F9FAFB' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}>
        <td style={TD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {open ? <ChevronUp size={13} color="#9CA3AF" /> : <ChevronDown size={13} color="#9CA3AF" />}
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{fila.cliente_nombre ?? '(Sin nombre)'}</div>
              <div style={{ fontSize: 11, color: '#9CA3AF' }}>{fila.cliente_rut ?? '—'}</div>
            </div>
          </div>
        </td>
        <td style={TD}>{suc?.nombre ?? '—'}</td>
        <td style={{ ...TD, textAlign: 'right', fontWeight: 700, fontSize: 14,
          color: saldo > 0 ? '#1E40AF' : saldo < 0 ? '#DC2626' : '#374151' }}>
          {fmt(saldo)}
        </td>
        <td style={{ ...TD, textAlign: 'center' }}>
          <span style={{ fontSize: 11, background: '#F3F4F6', color: '#374151', padding: '1px 6px', borderRadius: 10 }}>
            {fila.n_abonos ?? 0}
          </span>
        </td>
        <td style={{ ...TD, textAlign: 'center' }}>
          <span style={{ fontSize: 11, background: '#FFF7ED', color: '#C2410C', padding: '1px 6px', borderRadius: 10 }}>
            {fila.n_ventas_imputadas ?? 0}
          </span>
        </td>
        <td style={TD}>{fila.ultimo_movimiento ?? '—'}</td>
      </tr>
      {open && (
        <tr style={{ background: '#F9FAFB' }}>
          <td colSpan={6} style={{ padding: '0 16px 14px' }}>
            {loading && <div style={{ textAlign: 'center', padding: '16px 0' }}><Loader2 size={16} style={{ display: 'inline-block', color: '#9CA3AF' }} /></div>}
            {!loading && movs.length === 0 && <div style={{ color: '#9CA3AF', fontSize: 12, padding: '8px 0' }}>Sin movimientos registrados.</div>}
            {!loading && movs.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                    {['Fecha','Tipo','Medio','N° Doc BSALE','Monto','Obs'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: ['Monto'].includes(h)?'right':'left', color: '#9CA3AF', fontWeight: 600, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {movs.map(m => {
                    const efectivo = Number(m.monto) * Number(m.signo_ajuste ?? 1)
                    const esPos = efectivo > 0
                    const tipoLabel = { abono_recibido: '+ Abono recibido', venta_imputada: '− Venta imputada', nota_credito: '+ Nota crédito', ajuste: '± Ajuste' }[m.tipo] ?? m.tipo
                    const tipoColor = { abono_recibido: '#1E40AF', venta_imputada: '#C2410C', nota_credito: '#16A34A', ajuste: '#D97706' }[m.tipo] ?? '#374151'
                    return (
                      <tr key={m.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <td style={{ padding: '5px 10px' }}>{m.fecha}</td>
                        <td style={{ padding: '5px 10px', color: tipoColor, fontWeight: 600 }}>{tipoLabel}</td>
                        <td style={{ padding: '5px 10px', color: '#6B7280' }}>{m.medio_pago ?? '—'}</td>
                        <td style={{ padding: '5px 10px' }}>
                          {m.doc_bsale_numero ? `${m.doc_bsale_tipo ?? ''} N°${m.doc_bsale_numero}` : '—'}
                        </td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 700, color: esPos ? '#1E40AF' : '#C2410C' }}>
                          {esPos ? '+' : ''}{fmt(efectivo)}
                        </td>
                        <td style={{ padding: '5px 10px', color: '#9CA3AF' }}>{m.observaciones ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ── Modal ajuste manual ─────────────────────────────────────────────────────
function ModalAjuste({ sucursales, onClose, onSaved }) {
  const [form, setForm] = useState({
    tipo: 'abono_recibido', fecha: new Date().toISOString().slice(0,10),
    monto: '', medio_pago: 'efectivo', cliente_rut: '', cliente_nombre: '',
    sucursal_id: sucursales[0]?.id ?? '', doc_bsale_numero: '', observaciones: '',
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const signo = form.tipo === 'venta_imputada' ? -1 : 1

  async function guardar() {
    if (!form.monto || !form.fecha) { toast.error('Monto y fecha son obligatorios'); return }
    setSaving(true)
    try {
      await insertMovimientoCxc({
        tipo:            form.tipo,
        fecha:           form.fecha,
        monto:           Math.abs(Number(form.monto)),
        signo_ajuste:    signo,
        medio_pago:      form.medio_pago || null,
        cliente_rut:     form.cliente_rut || null,
        cliente_nombre:  form.cliente_nombre || null,
        sucursal_id:     form.sucursal_id || null,
        doc_bsale_numero: form.doc_bsale_numero ? Number(form.doc_bsale_numero) : null,
        observaciones:   form.observaciones || null,
        origen:          'manual',
      })
      toast.success('Movimiento CxC registrado')
      onSaved()
    } catch (e) { toast.error(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#fff', borderRadius: 12, width: 480, maxWidth: '95vw', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Registrar movimiento CxC manual</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}><X size={16} /></button>
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Tipo</label>
              <select style={selectSt} value={form.tipo} onChange={e => set('tipo', e.target.value)}>
                <option value="abono_recibido">+ Abono recibido</option>
                <option value="venta_imputada">− Venta imputada</option>
                <option value="nota_credito">+ Nota crédito</option>
                <option value="ajuste">± Ajuste</option>
              </select>
            </div>
            <div>
              <label style={labelSt}>Fecha</label>
              <input type="date" value={form.fecha} onChange={e => set('fecha', e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13 }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Monto ($)</label>
              <input type="number" value={form.monto} onChange={e => set('monto', e.target.value)} placeholder="0"
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13 }} />
            </div>
            <div>
              <label style={labelSt}>Medio de pago</label>
              <select style={selectSt} value={form.medio_pago} onChange={e => set('medio_pago', e.target.value)}>
                <option value="efectivo">Efectivo</option>
                <option value="debito">Débito</option>
                <option value="credito">Crédito</option>
                <option value="transferencia">Transferencia</option>
                <option value="otro">Otro</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>RUT cliente</label>
              <input value={form.cliente_rut} onChange={e => set('cliente_rut', e.target.value)} placeholder="12.345.678-9"
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13 }} />
            </div>
            <div>
              <label style={labelSt}>Nombre cliente</label>
              <input value={form.cliente_nombre} onChange={e => set('cliente_nombre', e.target.value)} placeholder="Razón social o nombre"
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13 }} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelSt}>Sucursal</label>
              <select style={selectSt} value={form.sucursal_id} onChange={e => set('sucursal_id', e.target.value)}>
                <option value="">— Sin sucursal —</option>
                {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelSt}>N° Doc BSALE</label>
              <input type="number" value={form.doc_bsale_numero} onChange={e => set('doc_bsale_numero', e.target.value)} placeholder="ej: 16534"
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13 }} />
            </div>
          </div>
          <div>
            <label style={labelSt}>Observaciones <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(opcional)</span></label>
            <input value={form.observaciones} onChange={e => set('observaciones', e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13 }} />
          </div>
          <div style={{ background: '#F9FAFB', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#6B7280' }}>
            Efecto en saldo cliente:
            <strong style={{ color: signo > 0 ? '#1E40AF' : '#C2410C', marginLeft: 6 }}>
              {signo > 0 ? '+' : '−'}{form.monto ? fmt(Number(form.monto)) : '$0'}
            </strong>
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={btnOutlineSt}>Cancelar</button>
          <button onClick={guardar} disabled={saving || !form.monto} style={{ ...btnSt(), opacity: (saving||!form.monto) ? 0.6 : 1 }}>
            {saving && <Loader2 size={13} />} Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Panel anual ─────────────────────────────────────────────────────────────
function TablaAnual({ anio, sucursal_id }) {
  const [rows, setRows]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchCuadraturasAnio({ anio, sucursal_id: sucursal_id === 'all' ? null : sucursal_id })
      .then(setRows).catch(() => setRows([])).finally(() => setLoading(false))
  }, [anio, sucursal_id])

  if (loading) return <div style={{ textAlign: 'center', padding: 24 }}><Loader2 size={18} style={{ display: 'inline-block', color: '#9CA3AF' }} /></div>
  if (!rows.length) return <div style={{ color: '#9CA3AF', fontSize: 13, padding: 16 }}>Sin datos de cuadratura anual para este año.</div>

  const tot = rows.reduce((a, r) => ({
    venta:  a.venta  + Number(r.venta_total  ?? 0),
    caja:   a.caja   + Number(r.caja_total   ?? 0),
    bruta:  a.bruta  + Number(r.brecha_bruta_total ?? 0),
    delta:  a.delta  + Number(r.delta_cxc_acumulado ?? 0),
    real:   a.real   + Number(r.brecha_real_total ?? 0),
  }), { venta: 0, caja: 0, bruta: 0, delta: 0, real: 0 })

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead><tr>
        {['Sucursal','Venta facturada','Caja declarada','Brecha bruta','Δ CxC acum.','Brecha real','¿Cuadra?'].map(h => (
          <th key={h} style={{ ...TH, textAlign: ['Venta facturada','Caja declarada','Brecha bruta','Δ CxC acum.','Brecha real'].includes(h) ? 'right' : 'left' }}>{h}</th>
        ))}
      </tr></thead>
      <tbody>
        {rows.map(r => {
          const cuadra = r.cuadra_anual
          const bReal  = Number(r.brecha_real_total ?? 0)
          return (
            <tr key={r.sucursal_id ?? 'global'} style={{ borderTop: '1px solid #F3F4F6' }}>
              <td style={TD}>{r.sucursal_nombre ?? r.sucursal_id ?? 'Todas'}</td>
              <td style={{ ...TD, textAlign: 'right', fontWeight: 600 }}>{fmt(r.venta_total)}</td>
              <td style={{ ...TD, textAlign: 'right' }}>{fmt(r.caja_total)}</td>
              <td style={{ ...TD, textAlign: 'right', color: '#D97706' }}>{fmt(r.brecha_bruta_total)}</td>
              <td style={{ ...TD, textAlign: 'right', color: Number(r.delta_cxc_acumulado) >= 0 ? '#1E40AF' : '#C2410C' }}>
                {Number(r.delta_cxc_acumulado) >= 0 ? '+' : ''}{fmt(r.delta_cxc_acumulado)}
              </td>
              <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: Math.abs(bReal)<5000 ? '#16A34A' : '#DC2626' }}>
                {bReal >= 0 ? '+' : ''}{fmt(bReal)}
              </td>
              <td style={{ ...TD, textAlign: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                  background: cuadra ? '#DCFCE7' : '#FEF3C7', color: cuadra ? '#16A34A' : '#D97706' }}>
                  {cuadra ? '✓ Sí' : '⚠ No'}
                </span>
              </td>
            </tr>
          )
        })}
        {/* Totales */}
        <tr style={{ borderTop: '2px solid #E5E7EB', background: '#F9FAFB' }}>
          <td style={{ ...TD, fontWeight: 700 }}>TOTAL AÑO</td>
          <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{fmt(tot.venta)}</td>
          <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{fmt(tot.caja)}</td>
          <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: '#D97706' }}>{fmt(tot.bruta)}</td>
          <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{tot.delta >= 0 ? '+' : ''}{fmt(tot.delta)}</td>
          <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: Math.abs(tot.real)<5000 ? '#16A34A' : '#DC2626' }}>
            {tot.real >= 0 ? '+' : ''}{fmt(tot.real)}
          </td>
          <td style={{ ...TD, textAlign: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
              background: Math.abs(tot.real)<5000 ? '#DCFCE7' : '#FEF3C7',
              color:      Math.abs(tot.real)<5000 ? '#16A34A' : '#D97706' }}>
              {Math.abs(tot.real) < 5000 ? '✓ Cuadra' : '⚠ Revisar'}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

// ── Componente principal CxcTab ─────────────────────────────────────────────
export function CxcTab({ usuario }) {
  const now = new Date()
  const esAdmin   = PUEDE_TODO.includes(usuario.rol)
  const [sucursales, setSucursales]   = useState([])
  const [sucursal, setSucursal]       = useState(esAdmin ? 'all' : (usuario.sucursal_id ?? ''))
  const [saldos, setSaldos]           = useState([])
  const [loadingSaldos, setLoadingSaldos] = useState(true)
  const [modalAjuste, setModalAjuste] = useState(false)
  const [anio, setAnio]               = useState(now.getFullYear())
  const [tabActiva, setTabActiva]     = useState('saldos') // 'saldos' | 'anual'
  const [busqueda, setBusqueda]       = useState('')

  const sucursalEf = sucursal === 'all' ? null : sucursal || null
  const anios = [now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1]

  useEffect(() => { fetchSucursales().then(setSucursales).catch(() => {}) }, [])

  function cargarSaldos() {
    setLoadingSaldos(true)
    fetchSaldosClientes({ sucursal_id: sucursalEf })
      .then(setSaldos).catch(e => toast.error(e.message)).finally(() => setLoadingSaldos(false))
  }

  useEffect(() => { cargarSaldos() }, [sucursalEf])

  const saldosFiltrados = saldos.filter(s =>
    !busqueda ||
    (s.cliente_nombre ?? '').toLowerCase().includes(busqueda.toLowerCase()) ||
    (s.cliente_rut ?? '').includes(busqueda)
  )

  const totalSaldo = saldos.reduce((s, r) => s + Number(r.saldo_actual ?? 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Filtros */}
      <div style={cardSt}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label style={labelSt}>Sucursal</label>
            <select style={selectSt} value={sucursal} disabled={!esAdmin} onChange={e => setSucursal(e.target.value)}>
              {esAdmin && <option value="all">Todas</option>}
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          {tabActiva === 'anual' && (
            <div>
              <label style={labelSt}>Año</label>
              <select style={selectSt} value={String(anio)} onChange={e => setAnio(Number(e.target.value))}>
                {anios.map(a => <option key={a} value={String(a)}>{a}</option>)}
              </select>
            </div>
          )}
          {tabActiva === 'saldos' && (
            <div>
              <label style={labelSt}>Buscar cliente</label>
              <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Nombre o RUT"
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13 }} />
            </div>
          )}
          {esAdmin && (
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button onClick={() => setModalAjuste(true)} style={{ ...btnSt(), width: '100%', justifyContent: 'center' }}>
                <Plus size={13} /> Mov. manual
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E5E7EB' }}>
        {[
          { id: 'saldos', label: 'Saldos por cliente' },
          { id: 'anual',  label: `Cuadratura anual ${anio}` },
        ].map(t => (
          <button key={t.id} onClick={() => setTabActiva(t.id)}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: tabActiva===t.id ? 600 : 400,
              color: tabActiva===t.id ? '#4F46E5' : '#6B7280', background: 'none', border: 'none',
              borderBottom: `2px solid ${tabActiva===t.id ? '#4F46E5' : 'transparent'}`,
              cursor: 'pointer', transition: 'all 0.15s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Resumen saldo total */}
      {tabActiva === 'saldos' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <div style={{ ...cardSt, padding: '14px 16px' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9CA3AF', marginBottom: 6 }}>Total saldo a favor clientes</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: totalSaldo > 0 ? '#1E40AF' : '#374151' }}>{fmt(totalSaldo)}</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 3 }}>{saldos.length} cliente{saldos.length !== 1 ? 's' : ''} con saldo vigente</div>
          </div>
          <div style={{ ...cardSt, padding: '14px 16px', background: '#EFF6FF' }}>
            <div style={{ fontSize: 11, color: '#1E40AF', marginBottom: 6 }}>
              El saldo a favor representa plata que los clientes abonaron pero aún no han imputado a una venta. Es una deuda de la empresa con el cliente (en forma de crédito para futuras compras).
            </div>
            <div style={{ fontSize: 11, color: '#1E40AF', fontWeight: 600 }}>
              Al cierre del año, este saldo debería acercarse a $0.
            </div>
          </div>
        </div>
      )}

      {/* Tabla saldos */}
      {tabActiva === 'saldos' && (
        <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #F3F4F6', fontSize: 14, fontWeight: 600 }}>
            Saldos vigentes por cliente
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                {['Cliente','Sucursal','Saldo actual','Abonos','Ventas imp.','Último mov.'].map(h => (
                  <th key={h} style={{ ...TH, textAlign: ['Saldo actual','Abonos','Ventas imp.'].includes(h) ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {loadingSaldos && (
                  <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', padding: '40px 0' }}>
                    <Loader2 size={18} style={{ display: 'inline-block', color: '#9CA3AF' }} />
                  </td></tr>
                )}
                {!loadingSaldos && !saldosFiltrados.length && (
                  <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', padding: '40px 0', color: '#9CA3AF' }}>
                    {busqueda ? 'Sin resultados para la búsqueda' : 'Sin saldos vigentes'}
                  </td></tr>
                )}
                {!loadingSaldos && saldosFiltrados.map(fila => (
                  <FilaCliente key={`${fila.cliente_rut}-${fila.sucursal_id}`} fila={fila} sucursales={sucursales} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cuadratura anual */}
      {tabActiva === 'anual' && (
        <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #F3F4F6', fontSize: 14, fontWeight: 600 }}>
            Cuadratura anual {anio} — Venta vs Caja
          </div>
          <div style={{ overflowX: 'auto' }}>
            <TablaAnual anio={anio} sucursal_id={sucursal} />
          </div>
          <div style={{ padding: '12px 16px', borderTop: '1px solid #F3F4F6', fontSize: 11, color: '#9CA3AF' }}>
            <strong>Lectura:</strong> Brecha bruta = Venta − Caja (siempre diferirán si hay abonos). Δ CxC = abonos recibidos − ventas imputadas. <strong>Brecha real = Brecha bruta − Δ CxC.</strong> Si Brecha real ≈ 0 el año cuadra contablemente.
          </div>
        </div>
      )}

      {modalAjuste && (
        <ModalAjuste
          sucursales={sucursales}
          onClose={() => setModalAjuste(false)}
          onSaved={() => { setModalAjuste(false); cargarSaldos() }}
        />
      )}
    </div>
  )
}
