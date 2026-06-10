import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabase'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, X, Save, Landmark } from 'lucide-react'

/* ═══ CRÉDITOS ═══
   Registro de deuda financiera vigente + análisis de carga financiera.
   - CRUD de créditos (solo roles de edición)
   - KPIs: deuda vigente, cuota mensual total, carga financiera vs venta
   - Cruce contra línea INTERES_CREDITOS del EERR (pagos reales por banco)
*/

const ROLES_EDIT = ['admin', 'admin_sistema', 'contabilidad', 'jefe_admin_finanzas', 'gerente_admin_finanzas']
const TIPOS = [
  { k: 'comercial', l: 'Crédito comercial' },
  { k: 'linea_credito', l: 'Línea de crédito' },
  { k: 'leasing', l: 'Leasing' },
  { k: 'consumo', l: 'Consumo' },
  { k: 'otro', l: 'Otro' },
]
const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

const VACIO = {
  institucion: '', tipo: 'comercial', descripcion: '',
  monto_original: '', fecha_otorgamiento: '', plazo_meses: '',
  tasa_interes_mensual: '', cuota_mensual: '', dia_pago: '', cuotas_pagadas: '0',
  estado: 'vigente', notas: '',
}

export function CreditosTab() {
  const [creditos, setCreditos] = useState([])
  const [interesEerr, setInteresEerr] = useState(new Array(12).fill(0))
  const [ventaNetaAnual, setVentaNetaAnual] = useState(0)
  const [mesesConVenta, setMesesConVenta] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [rol, setRol] = useState(null)
  const [modal, setModal] = useState(null)   // null | { ...credito } | { ...VACIO }
  const [guardando, setGuardando] = useState(false)
  const anio = new Date().getFullYear()

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true); setError(null)
    try {
      const [credR, userR, ventasR, lineaR] = await Promise.all([
        supabase.from('creditos').select('*').order('fecha_otorgamiento', { ascending: false }),
        supabase.auth.getUser(),
        supabase.from('ventas_bsale_dia').select('fecha, total_venta').gte('fecha', anio + '-01-01').lte('fecha', anio + '-12-31'),
        supabase.from('eerr_lineas').select('id').eq('codigo', 'INTERES_CREDITOS').maybeSingle(),
      ])
      if (credR.error) throw credR.error
      setCreditos(credR.data ?? [])

      const uid = userR.data.user?.id
      if (uid) {
        const { data: u } = await supabase.from('usuarios').select('rol').eq('auth_uid', uid).maybeSingle()
        setRol(u?.rol ?? null)
      }

      // Venta neta para carga financiera
      let vTotal = 0
      const mesesSet = new Set()
      ;(ventasR.data ?? []).forEach(v => {
        vTotal += Number(v.total_venta ?? 0) / 1.19
        mesesSet.add(new Date(v.fecha).getUTCMonth())
      })
      setVentaNetaAnual(vTotal)
      setMesesConVenta(Math.max(1, mesesSet.size))

      // Pagos reales de intereses/créditos desde movimientos bancarios mapeados
      if (lineaR.data?.id) {
        const { data: mapeos } = await supabase.from('eerr_mapeo').select('cuenta_madre_id').eq('eerr_linea_id', lineaR.data.id)
        const cmIds = (mapeos ?? []).map(m => m.cuenta_madre_id)
        if (cmIds.length) {
          const { data: subs } = await supabase.from('subcuentas').select('id').in('cuenta_madre_id', cmIds)
          const subIds = (subs ?? []).map(s => s.id)
          if (subIds.length) {
            const { data: movs } = await supabase.from('movimientos_bancarios')
              .select('fecha, monto').gte('fecha', anio + '-01-01').lte('fecha', anio + '-12-31')
              .lt('monto', 0).in('subcuenta_id', subIds).limit(20000)
            const arr = new Array(12).fill(0)
            ;(movs ?? []).forEach(mv => { arr[new Date(mv.fecha).getUTCMonth()] += Math.abs(Number(mv.monto ?? 0)) })
            setInteresEerr(arr)
          }
        }
      }
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const puedeEditar = rol && ROLES_EDIT.includes(rol)

  /* ── KPIs derivados ── */
  const kpis = useMemo(() => {
    const vigentes = creditos.filter(c => c.estado === 'vigente')
    const calc = vigentes.map(c => {
      const plazo = Number(c.plazo_meses || 0)
      const pagadas = Number(c.cuotas_pagadas || 0)
      const cuota = Number(c.cuota_mensual || 0)
      const restantes = Math.max(0, plazo - pagadas)
      const saldoEstimado = cuota * restantes
      const costoTotal = cuota * plazo
      const interesTotal = costoTotal - Number(c.monto_original || 0)
      // Fecha fin estimada
      const ini = c.fecha_otorgamiento ? new Date(c.fecha_otorgamiento) : null
      let fin = null
      if (ini && plazo) { fin = new Date(ini); fin.setMonth(fin.getMonth() + plazo) }
      return { ...c, restantes, saldoEstimado, interesTotal, fin }
    })
    const deudaTotal = calc.reduce((s, c) => s + c.saldoEstimado, 0)
    const cuotaMensualTotal = calc.reduce((s, c) => s + Number(c.cuota_mensual || 0), 0)
    const ventaPromMes = ventaNetaAnual / mesesConVenta
    const cargaFinancieraPct = ventaPromMes > 0 ? (cuotaMensualTotal / ventaPromMes) * 100 : 0
    const interesPagadoReal = interesEerr.reduce((s, v) => s + v, 0)
    return { vigentes: calc, deudaTotal, cuotaMensualTotal, cargaFinancieraPct, ventaPromMes, interesPagadoReal }
  }, [creditos, ventaNetaAnual, mesesConVenta, interesEerr])

  /* ── Guardar / eliminar ── */
  async function guardar() {
    if (!modal) return
    if (!modal.institucion || !modal.monto_original || !modal.fecha_otorgamiento || !modal.plazo_meses) {
      toast.error('Completa institución, monto, fecha y plazo'); return
    }
    setGuardando(true)
    try {
      const payload = {
        institucion: modal.institucion,
        tipo: modal.tipo,
        descripcion: modal.descripcion || null,
        monto_original: Number(modal.monto_original),
        fecha_otorgamiento: modal.fecha_otorgamiento,
        plazo_meses: Number(modal.plazo_meses),
        tasa_interes_mensual: modal.tasa_interes_mensual !== '' ? Number(modal.tasa_interes_mensual) : null,
        cuota_mensual: modal.cuota_mensual !== '' ? Number(modal.cuota_mensual) : null,
        dia_pago: modal.dia_pago !== '' ? Number(modal.dia_pago) : null,
        cuotas_pagadas: Number(modal.cuotas_pagadas || 0),
        estado: modal.estado,
        notas: modal.notas || null,
        updated_at: new Date().toISOString(),
      }
      let resp
      if (modal.id) resp = await supabase.from('creditos').update(payload).eq('id', modal.id)
      else resp = await supabase.from('creditos').insert(payload)
      if (resp.error) throw resp.error
      toast.success(modal.id ? 'Crédito actualizado' : 'Crédito registrado')
      setModal(null)
      await cargar()
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setGuardando(false) }
  }

  async function eliminar(c) {
    if (!window.confirm('¿Eliminar el crédito de ' + c.institucion + '? Esta acción no se puede deshacer.')) return
    const { error } = await supabase.from('creditos').delete().eq('id', c.id)
    if (error) { toast.error('Error: ' + error.message); return }
    toast.success('Crédito eliminado')
    await cargar()
  }

  const TH = { padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#6B7280', background: '#F9FAFB', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em' }
  const TD = { padding: '8px 10px', fontSize: 12, whiteSpace: 'nowrap' }
  const btnSt = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#374151' }
  const inputSt = { width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, boxSizing: 'border-box' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* KPIs de deuda */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        <KpiBox titulo="Deuda vigente estimada" valor={fmtCLP(kpis.deudaTotal)} sub={kpis.vigentes.length + ' crédito(s) vigente(s)'} color="#B91C1C" />
        <KpiBox titulo="Cuota mensual total" valor={fmtCLP(kpis.cuotaMensualTotal)} sub="Compromiso fijo de caja por mes" color="#B45309" />
        <KpiBox titulo="Carga financiera" valor={kpis.cargaFinancieraPct.toFixed(1) + '%'} sub={'Cuotas / venta neta promedio (' + fmtCLP(kpis.ventaPromMes) + ')'} color={kpis.cargaFinancieraPct <= 8 ? '#047857' : kpis.cargaFinancieraPct <= 15 ? '#B45309' : '#DC2626'} />
        <KpiBox titulo={'Intereses pagados ' + anio + ' (EERR)'} valor={fmtCLP(kpis.interesPagadoReal)} sub="Línea INTERES_CREDITOS desde banco" color="#6B7280" />
      </div>

      <div style={{ borderRadius: 8, border: '1px solid #BFDBFE', background: '#EFF6FF', padding: '10px 14px', fontSize: 11, color: '#1E40AF', lineHeight: 1.5 }}>
        <b>Referencia:</b> una carga financiera sana para pyme retail está bajo el 8% de la venta neta mensual; entre 8-15% requiere monitoreo; sobre 15% compromete la operación. El "saldo estimado" se calcula como cuota × cuotas restantes (incluye intereses futuros).
      </div>

      {/* Tabla de créditos */}
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #F3F4F6' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Landmark size={15} color="#1F4E79" />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Créditos registrados</span>
          </div>
          {puedeEditar && (
            <button onClick={() => setModal({ ...VACIO })} style={{ ...btnSt, background: '#1F4E79', color: '#fff', border: 'none' }}>
              <Plus size={13} /> Nuevo crédito
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 20 }}>{Array.from({ length: 3 }).map((_, i) => <div key={i} style={{ height: 36, background: '#F3F4F6', borderRadius: 6, marginBottom: 6 }} />)}</div>
        ) : error ? (
          <div style={{ padding: 16, fontSize: 13, color: '#DC2626' }}>
            Error: {error}
            {/relation "creditos" does not exist/i.test(error) && <div style={{ marginTop: 6, color: '#92400E' }}>⚠ Falta ejecutar la migración SQL de la tabla <code>creditos</code> en Supabase.</div>}
          </div>
        ) : creditos.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#9CA3AF' }}>
            Sin créditos registrados. {puedeEditar ? 'Usa "Nuevo crédito" para registrar la deuda vigente.' : ''}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                  <th style={TH}>Institución</th>
                  <th style={TH}>Tipo</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Monto original</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Cuota</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Avance</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Saldo est.</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Tasa</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Fin est.</th>
                  <th style={{ ...TH, textAlign: 'center' }}>Estado</th>
                  {puedeEditar && <th style={TH}></th>}
                </tr>
              </thead>
              <tbody>
                {kpis.vigentes.concat(creditos.filter(c => c.estado !== 'vigente').map(c => ({ ...c, restantes: 0, saldoEstimado: 0, fin: null }))).map(c => {
                  const plazo = Number(c.plazo_meses || 0)
                  const pagadas = Number(c.cuotas_pagadas || 0)
                  const avancePct = plazo > 0 ? (pagadas / plazo) * 100 : 0
                  return (
                    <tr key={c.id} style={{ borderBottom: '1px solid #F3F4F6', opacity: c.estado === 'vigente' ? 1 : 0.55 }}>
                      <td style={{ ...TD, fontWeight: 600, color: '#111827' }}>
                        {c.institucion}
                        {c.descripcion && <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 400 }}>{c.descripcion}</div>}
                      </td>
                      <td style={TD}>{TIPOS.find(t => t.k === c.tipo)?.l ?? c.tipo}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{fmtCLP(c.monto_original)}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{c.cuota_mensual ? fmtCLP(c.cuota_mensual) : '—'}</td>
                      <td style={{ ...TD, textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 2 }}>{pagadas}/{plazo}</div>
                        <div style={{ width: 70, height: 5, background: '#F3F4F6', borderRadius: 3, margin: '0 auto', overflow: 'hidden' }}>
                          <div style={{ width: avancePct + '%', height: '100%', background: avancePct >= 75 ? '#15803D' : '#1F4E79' }} />
                        </div>
                      </td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: c.saldoEstimado > 0 ? '#B91C1C' : '#9CA3AF' }}>{c.saldoEstimado > 0 ? fmtCLP(c.saldoEstimado) : '—'}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace' }}>{c.tasa_interes_mensual != null ? c.tasa_interes_mensual + '%/mes' : '—'}</td>
                      <td style={{ ...TD, textAlign: 'center', fontSize: 11 }}>{c.fin ? (MESES[c.fin.getMonth()] + ' ' + c.fin.getFullYear()) : '—'}</td>
                      <td style={{ ...TD, textAlign: 'center' }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: '0.04em',
                          background: c.estado === 'vigente' ? '#FEF3C7' : c.estado === 'pagado' ? '#DCFCE7' : '#F3F4F6',
                          color: c.estado === 'vigente' ? '#92400E' : c.estado === 'pagado' ? '#15803D' : '#6B7280',
                        }}>{(c.estado || '').toUpperCase()}</span>
                      </td>
                      {puedeEditar && (
                        <td style={{ ...TD, textAlign: 'right' }}>
                          <button onClick={() => setModal({ ...VACIO, ...c, monto_original: String(c.monto_original ?? ''), plazo_meses: String(c.plazo_meses ?? ''), tasa_interes_mensual: c.tasa_interes_mensual != null ? String(c.tasa_interes_mensual) : '', cuota_mensual: c.cuota_mensual != null ? String(c.cuota_mensual) : '', dia_pago: c.dia_pago != null ? String(c.dia_pago) : '', cuotas_pagadas: String(c.cuotas_pagadas ?? 0) })} style={{ ...btnSt, padding: '4px 8px', marginRight: 4 }}><Pencil size={12} /></button>
                          <button onClick={() => eliminar(c)} style={{ ...btnSt, padding: '4px 8px', color: '#DC2626' }}><Trash2 size={12} /></button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Intereses pagados mes a mes (cruce EERR) */}
      <div style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>PAGOS A CRÉDITOS {anio} — REAL DESDE BANCO (línea INTERES_CREDITOS)</div>
        <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 10 }}>
          Compara contra la cuota mensual comprometida ({fmtCLP(kpis.cuotaMensualTotal)}): si el pago real difiere mucho, hay créditos sin registrar o pagos extraordinarios.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(76px, 1fr))', gap: 6 }}>
          {MESES.map((m, i) => {
            const v = interesEerr[i] || 0
            const dif = kpis.cuotaMensualTotal > 0 && v > 0 ? v - kpis.cuotaMensualTotal : null
            return (
              <div key={m} style={{ background: '#F9FAFB', borderRadius: 7, padding: '8px 8px', textAlign: 'center', border: '1px solid #F3F4F6' }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#6B7280' }}>{m}</div>
                <div style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: v > 0 ? '#111827' : '#D1D5DB', marginTop: 2 }}>
                  {v > 0 ? fmtCLP(v) : '—'}
                </div>
                {dif !== null && Math.abs(dif) > kpis.cuotaMensualTotal * 0.15 && (
                  <div style={{ fontSize: 8, fontWeight: 700, color: dif > 0 ? '#DC2626' : '#B45309', marginTop: 1 }}>
                    {dif > 0 ? '▲' : '▼'} {fmtCLP(Math.abs(dif))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Modal CRUD */}
      {modal && (
        <>
          <div onClick={() => setModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 100, backdropFilter: 'blur(2px)' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(540px, 94vw)', maxHeight: '92vh', overflowY: 'auto', background: '#fff', borderRadius: 14, zIndex: 101, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', padding: '20px 22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{modal.id ? 'Editar crédito' : 'Nuevo crédito'}</span>
              <button onClick={() => setModal(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6B7280' }}><X size={18} /></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Campo label="Institución *"><input style={inputSt} value={modal.institucion} onChange={e => setModal(m => ({ ...m, institucion: e.target.value }))} placeholder="Banco Santander" /></Campo>
              <Campo label="Tipo *">
                <select style={inputSt} value={modal.tipo} onChange={e => setModal(m => ({ ...m, tipo: e.target.value }))}>
                  {TIPOS.map(t => <option key={t.k} value={t.k}>{t.l}</option>)}
                </select>
              </Campo>
              <Campo label="Descripción" span2><input style={inputSt} value={modal.descripcion} onChange={e => setModal(m => ({ ...m, descripcion: e.target.value }))} placeholder="Crédito capital de trabajo importación" /></Campo>
              <Campo label="Monto original (CLP) *"><input style={inputSt} inputMode="numeric" value={modal.monto_original} onChange={e => setModal(m => ({ ...m, monto_original: e.target.value.replace(/[^0-9]/g, '') }))} /></Campo>
              <Campo label="Fecha otorgamiento *"><input type="date" style={inputSt} value={modal.fecha_otorgamiento} onChange={e => setModal(m => ({ ...m, fecha_otorgamiento: e.target.value }))} /></Campo>
              <Campo label="Plazo (meses) *"><input style={inputSt} inputMode="numeric" value={modal.plazo_meses} onChange={e => setModal(m => ({ ...m, plazo_meses: e.target.value.replace(/[^0-9]/g, '') }))} /></Campo>
              <Campo label="Cuotas ya pagadas"><input style={inputSt} inputMode="numeric" value={modal.cuotas_pagadas} onChange={e => setModal(m => ({ ...m, cuotas_pagadas: e.target.value.replace(/[^0-9]/g, '') }))} /></Campo>
              <Campo label="Cuota mensual (CLP)"><input style={inputSt} inputMode="numeric" value={modal.cuota_mensual} onChange={e => setModal(m => ({ ...m, cuota_mensual: e.target.value.replace(/[^0-9]/g, '') }))} /></Campo>
              <Campo label="Tasa interés (%/mes)"><input style={inputSt} inputMode="decimal" value={modal.tasa_interes_mensual} onChange={e => setModal(m => ({ ...m, tasa_interes_mensual: e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.') }))} placeholder="1.2" /></Campo>
              <Campo label="Día de pago"><input style={inputSt} inputMode="numeric" value={modal.dia_pago} onChange={e => setModal(m => ({ ...m, dia_pago: e.target.value.replace(/[^0-9]/g, '') }))} placeholder="5" /></Campo>
              <Campo label="Estado">
                <select style={inputSt} value={modal.estado} onChange={e => setModal(m => ({ ...m, estado: e.target.value }))}>
                  <option value="vigente">Vigente</option>
                  <option value="pagado">Pagado</option>
                  <option value="refinanciado">Refinanciado</option>
                </select>
              </Campo>
              <Campo label="Notas" span2><input style={inputSt} value={modal.notas} onChange={e => setModal(m => ({ ...m, notas: e.target.value }))} /></Campo>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => setModal(null)} style={btnSt}>Cancelar</button>
              <button onClick={guardar} disabled={guardando} style={{ ...btnSt, background: '#15803D', color: '#fff', border: 'none', opacity: guardando ? 0.6 : 1 }}>
                <Save size={13} /> {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Campo({ label, children, span2 }) {
  return (
    <div style={{ gridColumn: span2 ? '1 / -1' : 'auto' }}>
      <label style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {children}
    </div>
  )
}

function KpiBox({ titulo, valor, sub, color }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }}>
      <div style={{ height: 4, background: color }} />
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>{titulo}</div>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color }}>{valor}</div>
        <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4 }}>{sub}</div>
      </div>
    </div>
  )
}
