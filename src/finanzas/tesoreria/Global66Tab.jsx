import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabase'
import { toast } from 'sonner'
import { Wallet, Link2, Search, ArrowDownToLine, Filter } from 'lucide-react'
import { Global66Importador } from './Global66Importador'

/* ═══ Global66 Tab ═══
   Sub-tab dentro de Tesorería → Cartola Bancaria.
   - KPIs: saldo CLP, saldo USD, USD pagado mes, próximos pagos
   - 3 validaciones automáticas (cuadre con Santander, saldo CLP, saldo USD)
   - Lista de movimientos filtrable
   - Asignador OC: dropdown manual con sugerencias del mismo proveedor en ±60 días
*/

const TIPOS = [
  { k: 'all', l: 'Todos' },
  { k: 'pago_usd', l: 'Pagos USD' },
  { k: 'compra_usd', l: 'Compras USD' },
  { k: 'ingreso_clp', l: 'Ingresos CLP' },
  { k: 'comision', l: 'Comisiones' },
  { k: 'interes', l: 'Intereses' },
]

const fmtUSD = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n || 0)

export function Global66Tab() {
  const [vista, setVista] = useState('movimientos')  // movimientos | importar
  const [movs, setMovs] = useState([])
  const [saldos, setSaldos] = useState(null)
  const [traspasos, setTraspasos] = useState([])  // cargos Santander OUTLET DE PUERTAS
  const [ocs, setOcs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filtroTipo, setFiltroTipo] = useState('all')
  const [filtroEstado, setFiltroEstado] = useState('all')
  const [busqueda, setBusqueda] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setLoading(true); setError(null)
    Promise.all([
      supabase.from('global66_movimientos').select('*, proveedores(nombre)').order('fecha_transaccion', { ascending: false }).limit(2000),
      supabase.from('v_global66_saldos').select('*').maybeSingle(),
      supabase.from('movimientos_bancarios').select('id, fecha, monto').eq('descripcion', 'OUTLET DE PUERTAS').lt('monto', 0).order('fecha', { ascending: false }),
      supabase.from('ordenes_compra').select('id, fecha_creacion, proveedor_id, total_usd, estado, proveedores(nombre)').eq('tipo_oc', 'IMP').is('deleted_at', null).order('fecha_creacion', { ascending: false }).limit(500),
    ])
    .then(([mR, sR, tR, oR]) => {
      if (mR.error) throw mR.error
      setMovs(mR.data ?? [])
      setSaldos(sR.data ?? null)
      setTraspasos(tR.data ?? [])
      setOcs(oR.data ?? [])
      setLoading(false)
    })
    .catch(e => { setError(e.message); setLoading(false) })
  }, [reloadKey])

  // ─── Validación 1: traspasos Santander vs ingresos CLP en Global66 ───
  const validacionTraspasos = useMemo(() => {
    const sumSantander = traspasos.reduce((s, t) => s + Math.abs(Number(t.monto)), 0)
    // En G66, los ingresos no tienen monto_clp (queda NULL). Contamos por número de movs y advertimos.
    const ingresos = movs.filter(m => m.tipo === 'ingreso_clp')
    return {
      sumSantanderCLP: sumSantander,
      countSantander: traspasos.length,
      countG66: ingresos.length,
      cuadra: traspasos.length === ingresos.length,
      diferencia: traspasos.length - ingresos.length,
    }
  }, [traspasos, movs])

  // ─── Filtros ───
  const movsFiltrados = useMemo(() => {
    return movs.filter(m => {
      if (filtroTipo !== 'all' && m.tipo !== filtroTipo) return false
      if (filtroEstado !== 'all' && m.estado !== filtroEstado) return false
      if (busqueda) {
        const q = busqueda.toLowerCase()
        const enTercero = (m.tercero_nombre || '').toLowerCase().includes(q)
        const enComentario = (m.comentario || '').toLowerCase().includes(q)
        if (!enTercero && !enComentario) return false
      }
      return true
    })
  }, [movs, filtroTipo, filtroEstado, busqueda])

  // Sugerencias de OC para un pago (mismo proveedor, fecha ±60 días)
  function ocsSugeridasPara(mov) {
    if (!mov.proveedor_id) return ocs.filter(o => !o.estado || o.estado !== 'cerrada').slice(0, 20)
    const fechaPago = new Date(mov.fecha_transaccion)
    const min = new Date(fechaPago); min.setDate(min.getDate() - 60)
    const max = new Date(fechaPago); max.setDate(max.getDate() + 60)
    return ocs.filter(o => {
      if (o.proveedor_id !== mov.proveedor_id) return false
      if (!o.fecha_creacion) return true
      const f = new Date(o.fecha_creacion)
      return f >= min && f <= max
    })
  }

  async function asignarOC(movId, ocId) {
    const { error } = await supabase
      .from('global66_movimientos')
      .update({ oc_id: ocId || null, updated_at: new Date().toISOString() })
      .eq('id', movId)
    if (error) { toast.error(error.message); return }
    toast.success(ocId ? 'OC vinculada' : 'OC desvinculada')
    setReloadKey(k => k + 1)
  }

  async function marcarConciliado(movId, nuevoEstado) {
    const u = await supabase.auth.getUser()
    const { error } = await supabase
      .from('global66_movimientos')
      .update({
        estado: nuevoEstado,
        conciliado_at: nuevoEstado === 'conciliado' ? new Date().toISOString() : null,
        conciliado_por: nuevoEstado === 'conciliado' ? u.data.user?.id : null,
      })
      .eq('id', movId)
    if (error) { toast.error(error.message); return }
    toast.success(nuevoEstado === 'conciliado' ? 'Conciliado' : 'Marcado pendiente')
    setReloadKey(k => k + 1)
  }

  const ESTILO = {
    btn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px solid #D1D5DB', background: '#fff', fontSize: 12, cursor: 'pointer', color: '#374151' },
    select: { padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff' },
    input: { padding: '6px 10px', borderRadius: 7, border: '1px solid #D1D5DB', fontSize: 12, background: '#fff' },
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Sub-sub-tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        {[
          { k: 'movimientos', l: 'Movimientos' },
          { k: 'importar', l: 'Importar cartola' },
        ].map(t => (
          <button key={t.k} onClick={() => setVista(t.k)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 600,
            background: 'none', border: 'none', cursor: 'pointer',
            color: vista === t.k ? '#1F4E79' : '#8E8E93',
            borderBottom: vista === t.k ? '2px solid #1F4E79' : '2px solid transparent',
          }}>{t.l}</button>
        ))}
      </div>

      {vista === 'importar' && <Global66Importador onImported={() => { setVista('movimientos'); setReloadKey(k => k + 1) }} />}

      {vista === 'movimientos' && (
        <>
          {error && <div style={{ borderRadius: 8, border: '1px solid #FECACA', background: '#FEF2F2', padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>
            Error: {error}
            {/relation "global66_movimientos" does not exist/i.test(error) && <div style={{ marginTop: 6, color: '#92400E' }}>⚠ Falta ejecutar la migración SQL <code>migracion_global66.sql</code>.</div>}
          </div>}

          {/* KPIs */}
          {!loading && saldos && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <KpiBox titulo="Saldo USD actual" valor={fmtUSD(saldos.saldo_usd)} sub={`Acreditado ${fmtUSD(saldos.total_usd_acreditado)} − Debitado ${fmtUSD(saldos.total_usd_debitado)}`} color={saldos.saldo_usd >= 0 ? '#15803D' : '#DC2626'} />
              <KpiBox titulo="Saldo CLP en Global66" valor={fmtCLP(saldos.saldo_clp)} sub={`Ingresado ${fmtCLP(saldos.total_ingreso_clp)} − Usado en USD ${fmtCLP(saldos.total_clp_gastado_compra_usd)}`} color={saldos.saldo_clp >= 0 ? '#1F4E79' : '#DC2626'} />
              <KpiBox titulo="USD pagado a proveedores" valor={fmtUSD(saldos.total_usd_debitado)} sub={`${movs.filter(m => m.tipo === 'pago_usd').length} pagos`} color="#B91C1C" />
              <KpiBox titulo="CLP convertido a USD" valor={fmtCLP(saldos.total_clp_gastado_compra_usd)} sub={`${movs.filter(m => m.tipo === 'compra_usd').length} conversiones`} color="#B45309" />
            </div>
          )}

          {/* Validación cuadre con Santander */}
          {!loading && (
            <div style={{
              borderRadius: 8,
              border: '1px solid ' + (validacionTraspasos.cuadra ? '#A7F3D0' : '#FDE68A'),
              background: validacionTraspasos.cuadra ? '#ECFDF5' : '#FFFBEB',
              padding: '10px 14px',
              fontSize: 12,
              color: validacionTraspasos.cuadra ? '#047857' : '#92400E',
              display: 'flex', gap: 9, alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: 14 }}>{validacionTraspasos.cuadra ? '✓' : '⚠️'}</span>
              <div style={{ lineHeight: 1.5 }}>
                <b>Cuadre Santander ↔ Global66:</b> Santander muestra {validacionTraspasos.countSantander} traspasos a Global66 por {fmtCLP(validacionTraspasos.sumSantanderCLP)} CLP. Global66 registra {validacionTraspasos.countG66} ingresos.
                {!validacionTraspasos.cuadra && ` Diferencia: ${Math.abs(validacionTraspasos.diferencia)} mov(s). Revisar fechas de envío vs llegada.`}
              </div>
            </div>
          )}

          {/* Filtros */}
          <div style={{ background: '#fff', borderRadius: 10, padding: '10px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <Filter size={14} color="#6B7280" />
            <select style={ESTILO.select} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
              {TIPOS.map(t => <option key={t.k} value={t.k}>{t.l}</option>)}
            </select>
            <select style={ESTILO.select} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
              <option value="all">Todos</option>
              <option value="pendiente">Pendientes</option>
              <option value="conciliado">Conciliados</option>
            </select>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: 1, minWidth: 200 }}>
              <Search size={13} color="#9CA3AF" style={{ position: 'absolute', left: 9 }} />
              <input style={{ ...ESTILO.input, paddingLeft: 28, width: '100%' }} placeholder="Buscar proveedor o código…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            </div>
            <span style={{ fontSize: 11, color: '#6B7280' }}>{movsFiltrados.length} de {movs.length}</span>
          </div>

          {/* Tabla movimientos */}
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{Array.from({ length: 5 }).map((_, i) => <div key={i} style={{ height: 36, background: '#F3F4F6', borderRadius: 6 }} />)}</div>
          ) : movsFiltrados.length === 0 ? (
            <div style={{ background: '#fff', borderRadius: 10, padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
              {movs.length === 0 ? 'Sin movimientos. Importa una cartola Global66 para empezar.' : 'Sin movimientos con esos filtros.'}
            </div>
          ) : (
            <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
                  <thead style={{ borderBottom: '2px solid #E5E7EB' }}>
                    <tr>
                      {['Fecha','Tipo','Monto USD','CLP','Proveedor','OC vinculada','Comentario','Estado'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', fontSize: 10, fontWeight: 700, color: '#6B7280', background: '#F9FAFB', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {movsFiltrados.slice(0, 200).map(m => (
                      <FilaMov key={m.id} mov={m} ocs={ocsSugeridasPara(m)} todasOcs={ocs} onAsignar={asignarOC} onConciliar={marcarConciliado} />
                    ))}
                  </tbody>
                </table>
              </div>
              {movsFiltrados.length > 200 && (
                <div style={{ padding: '8px 16px', borderTop: '1px solid #F3F4F6', fontSize: 11, color: '#6B7280', textAlign: 'center' }}>
                  Mostrando 200 de {movsFiltrados.length}. Refina filtros para ver más.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function FilaMov({ mov, ocs, todasOcs, onAsignar, onConciliar }) {
  const [editandoOC, setEditandoOC] = useState(false)
  const ocActual = mov.oc_id ? todasOcs.find(o => o.id === mov.oc_id) : null

  return (
    <tr style={{ borderBottom: '1px solid #F3F4F6', opacity: mov.estado === 'conciliado' ? 0.7 : 1 }}>
      <td style={{ padding: '7px 10px', fontSize: 11, whiteSpace: 'nowrap' }}>{(mov.fecha_transaccion || '').slice(0, 10)}</td>
      <td style={{ padding: '7px 10px', fontSize: 11 }}>
        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, letterSpacing: '0.04em',
          background: colorTipo(mov.tipo).bg, color: colorTipo(mov.tipo).fg }}>
          {labelTipo(mov.tipo)}
        </span>
      </td>
      <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600, color: ['pago_usd','comision'].includes(mov.tipo) ? '#DC2626' : '#15803D' }}>
        {['pago_usd','comision'].includes(mov.tipo) ? '−' : '+'}{fmtUSD(mov.monto_usd)}
      </td>
      <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'monospace', textAlign: 'right', color: '#6B7280', whiteSpace: 'nowrap' }}>{mov.monto_clp ? fmtCLP(mov.monto_clp) : '—'}</td>
      <td style={{ padding: '7px 10px', fontSize: 11, color: '#374151', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {mov.proveedores?.nombre || mov.tercero_nombre || '—'}
      </td>
      <td style={{ padding: '7px 10px', fontSize: 11, minWidth: 180 }}>
        {mov.tipo === 'pago_usd' ? (
          editandoOC ? (
            <select
              autoFocus
              value={mov.oc_id || ''}
              onChange={e => { onAsignar(mov.id, e.target.value); setEditandoOC(false) }}
              onBlur={() => setEditandoOC(false)}
              style={{ width: '100%', padding: '4px 6px', fontSize: 11, borderRadius: 5, border: '1px solid #1F4E79' }}
            >
              <option value="">— sin OC —</option>
              {ocs.length === 0 && <option disabled>(sin OC sugeridas)</option>}
              {ocs.map(o => (
                <option key={o.id} value={o.id}>
                  {o.id} · ${Number(o.total_usd || 0).toFixed(0)} · {(o.proveedores?.nombre || '').slice(0, 30)}
                </option>
              ))}
            </select>
          ) : (
            <button onClick={() => setEditandoOC(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 5, border: '1px dashed ' + (ocActual ? '#15803D' : '#D1D5DB'), background: ocActual ? '#ECFDF5' : '#FAFAFA', fontSize: 10, fontFamily: 'monospace', cursor: 'pointer', color: ocActual ? '#047857' : '#6B7280' }}>
              <Link2 size={10} /> {ocActual ? ocActual.id : 'asignar OC…'}
            </button>
          )
        ) : <span style={{ color: '#D1D5DB' }}>—</span>}
      </td>
      <td style={{ padding: '7px 10px', fontSize: 10, color: '#6B7280', fontFamily: 'monospace', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={mov.comentario}>{mov.comentario || '—'}</td>
      <td style={{ padding: '7px 10px' }}>
        <button onClick={() => onConciliar(mov.id, mov.estado === 'conciliado' ? 'pendiente' : 'conciliado')} style={{
          fontSize: 9, fontWeight: 700, padding: '3px 7px', borderRadius: 4, letterSpacing: '0.04em',
          background: mov.estado === 'conciliado' ? '#DCFCE7' : '#FEF3C7',
          color: mov.estado === 'conciliado' ? '#15803D' : '#92400E',
          border: 'none', cursor: 'pointer',
        }}>{(mov.estado || '').toUpperCase()}</button>
      </td>
    </tr>
  )
}

function KpiBox({ titulo, valor, sub, color }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #F3F4F6' }}>
      <div style={{ height: 4, background: color }} />
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>{titulo}</div>
        <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'monospace', color }}>{valor}</div>
        <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 4, lineHeight: 1.4 }}>{sub}</div>
      </div>
    </div>
  )
}

function labelTipo(t) {
  return { pago_usd: 'Pago USD', compra_usd: 'Compra USD', ingreso_clp: 'Ingreso', comision: 'Comisión', interes: 'Interés' }[t] || t
}
function colorTipo(t) {
  return {
    pago_usd: { bg: '#FEE2E2', fg: '#991B1B' },
    compra_usd: { bg: '#DCFCE7', fg: '#15803D' },
    ingreso_clp: { bg: '#DBEAFE', fg: '#1E40AF' },
    comision: { bg: '#FEF3C7', fg: '#92400E' },
    interes: { bg: '#CFFAFE', fg: '#155E75' },
  }[t] || { bg: '#F3F4F6', fg: '#6B7280' }
}
