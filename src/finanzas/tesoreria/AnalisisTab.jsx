import { useEffect, useMemo, useState, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Loader2, RefreshCw, X, AlertTriangle, AlertCircle,
  ArrowDownCircle, ArrowUpCircle, Link2, Unlink, Search,
} from 'lucide-react'
import { DataGrid } from '../conciliacion/DataGrid'
import { formatCLP, cardSt, inputSt, selectSt, labelSt, btnSt, btnOutlineSt } from './types'
import {
  fetchSucursales, fetchControlConciliacion, fetchAbonosTrazabilidad, fetchAbonosPorConciliar,
  fetchCandidatosAbono, asignarClienteAbono, quitarAsignacionAbono, fetchNcControl, fetchAbonosPasivo,
  fetchFrescuraLedger, buscarClienteBsale, fetchCuentaClientes, fetchCreditoDestino,
} from './api'

/* ═══════════════════════════════════════════════════════════════════════════
   ABONOS · Cuenta corriente de crédito del cliente

   El abono tiene cuatro movimientos, no dos. Entra de dos formas (plata que el
   cliente adelanta sin documento tributario, o crédito que nace de una nota de
   crédito) y sale de dos (imputado a un documento con medio Abono cliente, o
   con medio NC). BSALE mantiene UNA sola bolsa por cliente: el medio con que se
   consume no indica de dónde vino el crédito.

   Esta pantalla existe para hacerle seguimiento a eso: qué entró, qué se imputó,
   qué queda sin identificar, y qué notas de crédito no tienen destino registrado.
   ═══════════════════════════════════════════════════════════════════════════ */

const C = {
  azul: '#1F4E79', azul2: '#2E7CB8', verde: '#16A34A', verdeBg: '#DCFCE7',
  naranja: '#D97706', naranjaBg: '#FEF3C7', rojo: '#DC2626', rojoBg: '#FEE2E2',
  gris: '#6B7280', grisBg: '#F3F4F6', texto: '#111827', morado: '#7C3AED', moradoBg: '#EDE9FE',
}
const fmt = n => formatCLP(n ?? 0)
const fmtC = n => {
  const a = Math.abs(n ?? 0)
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`
  return fmt(n)
}
const pct1 = (a, b) => b ? ((a / b) * 100).toFixed(1) : '0.0'
const MESES = ['Año completo', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const MOVIMIENTOS = {
  ENTRADA_PLATA: { l: 'Entrada en plata', desc: 'El cliente paga por adelantado, sin documento tributario', color: C.verde, bg: C.verdeBg, ic: ArrowDownCircle },
  ENTRADA_NC:    { l: 'Entrada por NC',   desc: 'Crédito que nace de una nota de crédito',                  color: C.azul2, bg: '#DBEAFE', ic: ArrowDownCircle },
  APLICA_PLATA:  { l: 'Imputación',       desc: 'Se emite el documento y se consume saldo (medio Abono cliente)', color: C.naranja, bg: C.naranjaBg, ic: ArrowUpCircle },
  APLICA_NC:     { l: 'Imputación por NC', desc: 'Se emite el documento y se consume saldo (medio NC)',      color: C.morado, bg: C.moradoBg, ic: ArrowUpCircle },
}
const EFECTOS_NC = {
  credito_generado:       { l: 'Crédito generado',      color: C.azul2,   bg: '#DBEAFE' },
  credito_usado_en_venta: { l: 'Crédito usado',         color: C.morado,  bg: C.moradoBg },
  devolucion_dinero:      { l: 'Devolución de dinero',  color: C.rojo,    bg: C.rojoBg },
  anulacion:              { l: 'Anulación',             color: C.gris,    bg: C.grisBg },
  sin_efecto_registrado:  { l: 'Sin destino registrado', color: C.naranja, bg: C.naranjaBg },
}

function Chip({ texto, color, bg, titulo }) {
  return (
    <span title={titulo} style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 4, fontSize: 10,
      fontWeight: 600, background: bg, color, whiteSpace: 'nowrap',
    }}>{texto}</span>
  )
}

function Kpi({ label, valor, sub, color = C.azul, alerta }) {
  return (
    <div style={{ ...cardSt, padding: '11px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ fontSize: 19, fontWeight: 700, color, lineHeight: 1.1 }}>{valor}</div>
      {sub && (
        <div style={{ fontSize: 10, color: alerta ? C.naranja : '#9CA3AF', marginTop: 3, fontWeight: alerta ? 600 : 400 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

/* ─── Barra de conciliación: cuánto está identificado y cuánto falta ─── */
function BarraConciliacion({ conciliado, porConfirmar, porRevisar, sinMatch, sinCliente }) {
  const total = conciliado + porConfirmar + porRevisar + sinMatch + sinCliente
  if (!total) return null
  const tramos = [
    { l: 'Conciliado', v: conciliado, c: C.verde },
    { l: 'Por confirmar', v: porConfirmar, c: C.azul2 },
    { l: 'Por revisar', v: porRevisar, c: C.naranja },
    { l: 'Sin match', v: sinMatch, c: C.rojo },
    { l: 'Boleta sin cliente', v: sinCliente, c: '#9CA3AF' },
  ].filter(t => t.v > 0)
  return (
    <div style={{ ...cardSt, padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: C.gris, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Estado de conciliación del período
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.verde }}>
          {pct1(conciliado, total)}% identificado
        </span>
      </div>
      <div style={{ display: 'flex', height: 18, borderRadius: 5, overflow: 'hidden', background: '#F9FAFB' }}>
        {tramos.map(t => (
          <div key={t.l} title={`${t.l}: ${fmt(t.v)}`}
            style={{ width: `${(t.v / total) * 100}%`, background: t.c, transition: 'width .6s ease' }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
        {tramos.map(t => (
          <span key={t.l} style={{ fontSize: 10, color: C.gris, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: t.c, display: 'inline-block' }} />
            {t.l} <strong style={{ color: C.texto }}>{fmtC(t.v)}</strong>
          </span>
        ))}
      </div>
    </div>
  )
}

/* ─── Panel de asignación manual de cliente a una entrada en plata ─── */
function PanelAsignacion({ entrada, onCerrar, onAsignado }) {
  const [candidatos, setCandidatos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [clienteId, setClienteId] = useState('')
  const [clienteNombre, setClienteNombre] = useState('')
  const [confianza, setConfianza] = useState('media')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)

  // Debounce: sin esto cada tecla dispara una consulta
  useEffect(() => {
    const t = (busqueda ?? '').trim()
    if (t.length < 3) { setResultados([]); return }
    setBuscando(true)
    const id = setTimeout(() => {
      buscarClienteBsale(t).then(setResultados).catch(() => setResultados([])).finally(() => setBuscando(false))
    }, 350)
    return () => { clearTimeout(id); setBuscando(false) }
  }, [busqueda])

  useEffect(() => {
    let vivo = true
    fetchCandidatosAbono(entrada.pago_id)
      .then(d => { if (vivo) setCandidatos(d) })
      .catch(() => { if (vivo) setCandidatos([]) })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [entrada.pago_id])

  async function guardar() {
    if (!clienteId || !/^\d+$/.test(String(clienteId).trim())) {
      toast.error('Ingresa el ID de cliente de BSALE (solo números)')
      return
    }
    setGuardando(true)
    try {
      await asignarClienteAbono({
        bsale_pago_id: entrada.pago_id, cliente_id: clienteId,
        cliente_nombre: clienteNombre, confianza, nota,
      })
      toast.success('Abono asignado al cliente')
      onAsignado()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo asignar')
    } finally { setGuardando(false) }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(480px, 100vw)',
      background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', zIndex: 60,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.texto }}>Identificar abono</div>
          <div style={{ fontSize: 11, color: C.gris, marginTop: 2 }}>
            {entrada.fecha} · {entrada.sucursal_id} · {entrada.recaudador} · {entrada.medio}
          </div>
        </div>
        <button onClick={onCerrar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.gris, padding: 2 }}>
          <X size={18} />
        </button>
      </div>

      <div style={{ padding: '14px 18px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ background: C.verdeBg, borderRadius: 8, padding: '10px 14px' }}>
          <div style={{ fontSize: 10, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Monto recibido</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#166534' }}>{fmt(entrada.monto)}</div>
          <div style={{ fontSize: 10, color: '#166534', opacity: 0.8, marginTop: 2 }}>
            Hace {entrada.antiguedad_dias} días · pago BSALE #{entrada.pago_id}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.texto, marginBottom: 6 }}>
            Imputaciones que calzan {cargando && <Loader2 size={11} style={{ display: 'inline' }} />}
          </div>
          {!cargando && candidatos.length === 0 && (
            <div style={{ fontSize: 11, color: C.gris, background: '#F9FAFB', borderRadius: 8, padding: '10px 12px' }}>
              No hay ninguna venta con este monto exacto en la sucursal dentro de los 120 días
              siguientes. Puede que el cliente todavía no haya retirado, o que el abono se haya
              consumido en partes. Busca el comprobante en BSALE e ingresa el cliente a mano.
            </div>
          )}
          {candidatos.map(c => (
            <button key={c.aplicacion_id} onClick={() => { setClienteId(String(c.cliente_id)); setConfianza(c.confianza); setClienteNombre(c.cliente_nombre ?? '') }}
              style={{
                width: '100%', textAlign: 'left', background: String(clienteId) === String(c.cliente_id) ? '#EFF6FF' : '#F9FAFB',
                border: String(clienteId) === String(c.cliente_id) ? `1px solid ${C.azul2}` : '1px solid transparent',
                borderRadius: 7, padding: '8px 11px', marginBottom: 5, cursor: 'pointer',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.texto }}>{c.cliente_nombre ?? `Cliente ${c.cliente_id}`}</span>
                <Chip texto={c.confianza}
                  color={c.confianza === 'alta' ? C.verde : c.confianza === 'media' ? C.naranja : C.gris}
                  bg={c.confianza === 'alta' ? C.verdeBg : c.confianza === 'media' ? C.naranjaBg : C.grisBg} />
              </div>
              <div style={{ fontSize: 10, color: C.gris, marginTop: 2 }}>
                Doc {c.document_numero ?? '—'} · {fmt(c.aplicacion_monto)} · {c.aplicacion_fecha}
                {c.dias > 0 && ` · ${c.dias} día${c.dias !== 1 ? 's' : ''} después`}
              </div>
            </button>
          ))}
        </div>

        <div>
          <label style={labelSt}>Buscar cliente por nombre o RUT</label>
          <div style={{ position: 'relative' }}>
            <input style={{ ...inputSt, paddingLeft: 28 }} value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Escribe al menos 3 letras o el RUT" />
            <Search size={13} style={{ position: 'absolute', left: 9, top: 10, color: '#9CA3AF' }} />
          </div>
          {buscando && <div style={{ fontSize: 10, color: C.gris, marginTop: 4 }}>Buscando…</div>}
          {resultados.length > 0 && (
            <div style={{ marginTop: 5, maxHeight: 150, overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 7 }}>
              {resultados.map(c => (
                <button key={c.bsale_id}
                  onClick={() => { setClienteId(String(c.bsale_id)); setClienteNombre(c.nombre ?? ''); setResultados([]); setBusqueda(c.nombre ?? '') }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', background: 'none',
                    border: 'none', borderBottom: '1px solid #F1F5F9', padding: '6px 10px', cursor: 'pointer', fontSize: 12,
                  }}>
                  <span style={{ fontWeight: 500 }}>{c.nombre ?? `Cliente ${c.bsale_id}`}</span>
                  {c.rut && <span style={{ color: '#9CA3AF', fontSize: 10, marginLeft: 6 }}>{c.rut}</span>}
                </button>
              ))}
            </div>
          )}
          {busqueda.trim().length >= 3 && !buscando && resultados.length === 0 && (
            <div style={{ fontSize: 10, color: C.gris, marginTop: 4 }}>Sin coincidencias en el catálogo de clientes.</div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={labelSt}>ID cliente BSALE</label>
            <input style={inputSt} value={clienteId} onChange={e => setClienteId(e.target.value)}
              placeholder="ej. 13569" inputMode="numeric" />
          </div>
          <div>
            <label style={labelSt}>Confianza</label>
            <select style={selectSt} value={confianza} onChange={e => setConfianza(e.target.value)}>
              <option value="alta">Alta — comprobante verificado</option>
              <option value="media">Media — calce por monto</option>
              <option value="baja">Baja — supuesto</option>
            </select>
          </div>
        </div>
        <div>
          <label style={labelSt}>Respaldo de la asignación</label>
          <textarea style={{ ...inputSt, resize: 'vertical', fontFamily: 'inherit' }} rows={2} value={nota}
            onChange={e => setNota(e.target.value)}
            placeholder="N° de comprobante de abono, quién confirmó, o cómo se verificó" />
          <div style={{ fontSize: 10, color: C.gris, marginTop: 3 }}>
            Queda registrado quién asignó y cuándo. Es reversible.
          </div>
        </div>
      </div>

      <div style={{ padding: '12px 18px', borderTop: '1px solid #E5E7EB', display: 'flex', gap: 8 }}>
        <button onClick={onCerrar} style={{ ...btnOutlineSt, flex: '0 0 auto' }}>Cancelar</button>
        <button onClick={guardar} disabled={guardando} style={{ ...btnSt(), flex: 1, justifyContent: 'center', opacity: guardando ? 0.6 : 1 }}>
          {guardando ? <Loader2 size={13} /> : <Link2 size={13} />} Asignar cliente
        </button>
      </div>
    </div>
  )
}

/* ═══════════════════════════ COMPONENTE PRINCIPAL ═══════════════════════════ */
export function AbonosTab({ usuario }) {
  const hoy = new Date()
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth() + 1)
  const [sucursales, setSucursales] = useState([])
  const [sucursalSel, setSucursalSel] = useState('')
  const [seccion, setSeccion] = useState('resumen')

  const [control, setControl] = useState([])
  const [pasivo, setPasivo] = useState([])
  const [movs, setMovs] = useState([])
  const [cola, setCola] = useState([])
  const [ncs, setNcs] = useState([])
  const [cuentas, setCuentas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [filtroMov, setFiltroMov] = useState('')
  const [filtroEfecto, setFiltroEfecto] = useState('')
  const [asignando, setAsignando] = useState(null)
  const [frescura, setFrescura] = useState([])

  useEffect(() => {
    fetchSucursales().then(setSucursales).catch(() => {})
    fetchFrescuraLedger().then(setFrescura).catch(() => {})
  }, [])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [ctrl, pas, mv, cl, nc, cc] = await Promise.all([
        fetchControlConciliacion(anio, sucursalSel).catch(() => []),
        fetchAbonosPasivo().catch(() => []),
        fetchAbonosTrazabilidad({ anio, mes, sucursal_id: sucursalSel, movimiento: filtroMov || null }).catch(() => []),
        fetchAbonosPorConciliar({ sucursal_id: sucursalSel }).catch(() => []),
        fetchNcControl({ anio, mes, sucursal_id: sucursalSel, efecto: filtroEfecto || null }).catch(() => []),
        fetchCuentaClientes({}).catch(() => []),
      ])
      setControl(ctrl); setPasivo(pas); setMovs(mv); setCola(cl); setNcs(nc); setCuentas(cc)
    } finally { setCargando(false) }
  }, [anio, mes, sucursalSel, filtroMov, filtroEfecto])

  useEffect(() => { cargar() }, [cargar])

  // ─── Agregados del período seleccionado ───
  const resumen = useMemo(() => {
    const filas = mes ? control.filter(c => new Date(c.mes + 'T00:00:00').getMonth() + 1 === mes) : control
    const s = (k) => filas.reduce((a, r) => a + Number(r[k] ?? 0), 0)
    const venta = s('venta'), recaudacion = s('recaudacion')
    const movTotal = s('mov_total'), movConc = s('mov_conciliados')
    return {
      venta, recaudacion, desvio: recaudacion - venta,
      movTotal, movConc,
      porConfirmar: s('por_confirmar'), porRevisar: s('por_revisar'),
      sinMatch: s('sin_match'), sinCliente: s('sin_cliente_boleta'),
      ncDinero: s('nc_devolucion_dinero'), ncCredito: s('nc_credito_generado'),
      ncAnulacion: s('nc_anulacion'), ncSinExplicar: s('nc_sin_explicar'),
      nNcSinExplicar: s('n_nc_sin_explicar'),
      credVigente: s('credito_vigente'), credConsumido: s('credito_consumido'),
      credSinCliente: s('credito_sin_cliente'), credReverso: s('credito_reverso_tarjeta'),
      nReverso: s('n_reverso_tarjeta'), credSinRastro: s('credito_sin_rastro'),
    }
  }, [control, mes])

  // Todos los tramos salen de las MISMAS filas cargadas: si unos vinieran del panel
  // mensual y otros de la grilla, los totales no cerrarían al filtrar por sucursal.
  const tramos = useMemo(() => {
    const t = { conciliado: 0, porConfirmar: 0, porRevisar: 0, sinMatch: 0, sinCliente: 0 }
    for (const m of movs) {
      const e = m.estado_conciliacion ?? '', v = Number(m.monto ?? 0)
      if (e.startsWith('conciliado')) t.conciliado += v
      else if (e.startsWith('por confirmar')) t.porConfirmar += v
      else if (e.startsWith('por revisar')) t.porRevisar += v
      else if (e.startsWith('sin match')) t.sinMatch += v
      else t.sinCliente += v
    }
    return t
  }, [movs])
  const montoConciliado = tramos.conciliado

  const porMovimiento = useMemo(() => {
    const acc = {}
    for (const m of movs) {
      const k = m.movimiento
      if (!acc[k]) acc[k] = { n: 0, monto: 0, conciliado: 0 }
      acc[k].n += 1; acc[k].monto += Number(m.monto ?? 0)
      if ((m.estado_conciliacion ?? '').startsWith('conciliado')) acc[k].conciliado += Number(m.monto ?? 0)
    }
    return acc
  }, [movs])

  // ─── Columnas ───
  const colsMov = useMemo(() => [
    { key: 'fecha', label: 'Fecha', width: 92 },
    { key: 'sucursal_id', label: 'Sucursal', width: 92 },
    {
      key: 'movimiento', label: 'Movimiento', width: 150,
      render: r => {
        const m = MOVIMIENTOS[r.movimiento]
        return m ? <Chip texto={m.l} color={m.color} bg={m.bg} titulo={m.desc} /> : r.movimiento
      },
    },
    { key: 'monto', label: 'Monto', align: 'right', width: 110, render: r => fmt(r.monto) },
    {
      key: 'monto_saldo', label: 'Efecto en saldo', align: 'right', width: 120,
      render: r => (
        <span style={{ color: Number(r.monto_saldo) > 0 ? C.verde : C.naranja, fontWeight: 600 }}>
          {Number(r.monto_saldo) > 0 ? '+' : ''}{fmt(r.monto_saldo)}
        </span>
      ),
    },
    {
      key: 'cliente_nombre', label: 'Cliente', width: 220,
      value: r => r.cliente_nombre ?? (r.cliente_id ? `Cliente ${r.cliente_id}` : ''),
      render: r => {
        if (!r.cliente_id) return <span style={{ color: '#D1D5DB' }}>—</span>
        return (
          <span title={`ID BSALE ${r.cliente_id}`}>
            <span style={{ fontWeight: 500 }}>{r.cliente_nombre ?? `Cliente ${r.cliente_id}`}</span>
            {r.cliente_rut && <span style={{ color: '#9CA3AF', fontSize: 10, marginLeft: 5 }}>{r.cliente_rut}</span>}
          </span>
        )
      },
    },
    { key: 'document_numero', label: 'Documento', width: 100, render: r => r.document_numero ?? <span style={{ color: '#D1D5DB' }}>—</span> },
    { key: 'recaudador', label: 'Recaudador', width: 150 },
    { key: 'medio', label: 'Medio', width: 120 },
    {
      key: 'accion_mov', label: '', width: 40, sortable: false, filterable: false,
      render: r => r.origen_asignacion ? (
        <button title={`Asignado ${r.origen_asignacion}${r.nota_asignacion ? ': ' + r.nota_asignacion : ''}. Quitar asignación.`}
          onClick={async e => {
            e.stopPropagation()
            if (!window.confirm('¿Quitar la asignación de cliente de este abono?')) return
            try { await quitarAsignacionAbono(r.pago_id); toast.success('Asignación quitada'); cargar() }
            catch (err) { toast.error(err instanceof Error ? err.message : 'No se pudo quitar') }
          }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 2, display: 'flex' }}>
          <Unlink size={12} />
        </button>
      ) : null,
    },
    {
      key: 'estado_conciliacion', label: 'Estado', width: 230,
      render: r => {
        const e = r.estado_conciliacion ?? ''
        const cfg = e.startsWith('conciliado') ? { c: C.verde, b: C.verdeBg }
          : e.startsWith('por confirmar') ? { c: C.azul2, b: '#DBEAFE' }
          : e.startsWith('por revisar') ? { c: C.naranja, b: C.naranjaBg }
          : e.startsWith('sin match') ? { c: C.rojo, b: C.rojoBg }
          : { c: C.gris, b: C.grisBg }
        return <Chip texto={e} color={cfg.c} bg={cfg.b} />
      },
    },
  ], [cargar])

  const colsCola = useMemo(() => [
    { key: 'fecha', label: 'Fecha', width: 92 },
    { key: 'sucursal_id', label: 'Sucursal', width: 92 },
    { key: 'recaudador', label: 'Recaudador', width: 160 },
    { key: 'medio', label: 'Medio', width: 120 },
    { key: 'monto', label: 'Monto', align: 'right', width: 112, render: r => <strong>{fmt(r.monto)}</strong> },
    {
      key: 'antiguedad_dias', label: 'Antigüedad', align: 'right', width: 95,
      render: r => (
        <span style={{ color: r.antiguedad_dias > 180 ? C.rojo : r.antiguedad_dias > 90 ? C.naranja : C.gris, fontWeight: 600 }}>
          {r.antiguedad_dias} d
        </span>
      ),
    },
    {
      key: 'diagnostico', label: 'Diagnóstico', width: 300,
      render: r => {
        const d = r.diagnostico ?? ''
        const cfg = d.startsWith('candidato único') ? { c: C.azul2, b: '#DBEAFE' }
          : d.startsWith('varios') ? { c: C.naranja, b: C.naranjaBg }
          : { c: C.rojo, b: C.rojoBg }
        return <Chip texto={d} color={cfg.c} bg={cfg.b} />
      },
    },
    {
      key: 'accion', label: '', width: 110, sortable: false, filterable: false,
      render: r => (
        <button onClick={e => { e.stopPropagation(); setAsignando(r) }}
          style={{ ...btnOutlineSt, padding: '3px 9px', fontSize: 11 }}>
          <Link2 size={11} /> Identificar
        </button>
      ),
    },
  ], [])

  const colsNc = useMemo(() => [
    { key: 'fecha', label: 'Fecha', width: 92 },
    { key: 'sucursal_id', label: 'Sucursal', width: 92 },
    { key: 'monto', label: 'Monto', align: 'right', width: 110, render: r => fmt(r.monto) },
    {
      key: 'efecto', label: 'Efecto', width: 160,
      render: r => {
        const e = EFECTOS_NC[r.efecto]
        return e ? <Chip texto={e.l} color={e.color} bg={e.bg} /> : r.efecto
      },
    },
    {
      key: 'diagnostico_plata', label: 'Qué pasó con la plata', width: 340,
      render: r => {
        const alerta = (r.diagnostico_plata ?? '').startsWith('EL CLIENTE')
        return (
          <span style={{ fontSize: 11, color: alerta ? C.rojo : C.gris, fontWeight: alerta ? 600 : 400 }}>
            {alerta && <AlertTriangle size={11} style={{ display: 'inline', marginRight: 4 }} />}
            {r.diagnostico_plata}
          </span>
        )
      },
    },
    { key: 'ref_doc_numero', label: 'Doc origen', width: 100 },
    {
      key: 'cliente_nombre', label: 'Cliente', width: 200,
      value: r => r.cliente_nombre ?? r.pv_cliente ?? (r.cliente_id ? `Cliente ${r.cliente_id}` : ''),
      render: r => {
        const nom = r.cliente_nombre ?? r.pv_cliente
        if (!nom && !r.cliente_id) return <span style={{ color: '#D1D5DB' }}>—</span>
        return (
          <span title={r.cliente_id ? `ID BSALE ${r.cliente_id}` : 'desde el caso de postventa'}>
            {nom ?? `Cliente ${r.cliente_id}`}
            {(r.cliente_rut ?? r.pv_rut) && <span style={{ color: '#9CA3AF', fontSize: 10, marginLeft: 5 }}>{r.cliente_rut ?? r.pv_rut}</span>}
          </span>
        )
      },
    },
    {
      key: 'caso_postventa', label: 'Caso postventa', width: 130,
      render: r => r.caso_postventa
        ? <span style={{ fontSize: 11 }}>{r.caso_postventa} {r.codigo_final && <Chip texto={r.codigo_final} color={C.azul} bg="#DBEAFE" />}</span>
        : <span style={{ color: '#D1D5DB', fontSize: 11 }}>sin caso</span>,
    },
    { key: 'motivo', label: 'Motivo', width: 260 },
  ], [])

  const colsCuenta = useMemo(() => [
    {
      key: 'cliente_nombre', label: 'Cliente', width: 240,
      value: r => r.cliente_nombre ?? `Cliente ${r.cliente_id}`,
      render: r => (
        <span title={`ID BSALE ${r.cliente_id}`}>
          <span style={{ fontWeight: 500 }}>{r.cliente_nombre ?? `Cliente ${r.cliente_id}`}</span>
          {r.cliente_rut && <span style={{ color: '#9CA3AF', fontSize: 10, marginLeft: 5 }}>{r.cliente_rut}</span>}
        </span>
      ),
    },
    { key: 'entrada_plata', label: 'Entró plata', align: 'right', width: 105, render: r => fmt(r.entrada_plata) },
    { key: 'entrada_nc', label: 'Entró por NC', align: 'right', width: 105, render: r => fmt(r.entrada_nc) },
    {
      key: 'aplicado', label: 'Imputado', align: 'right', width: 105,
      value: r => Number(r.aplicado_plata ?? 0) + Number(r.aplicado_nc ?? 0),
      render: r => fmt(Number(r.aplicado_plata ?? 0) + Number(r.aplicado_nc ?? 0)),
    },
    {
      key: 'saldo_a_favor', label: 'Saldo según libro', align: 'right', width: 125,
      render: r => (
        <strong style={{ color: Number(r.saldo_a_favor) > 1000 ? C.verde : Number(r.saldo_a_favor) < -1000 ? C.gris : C.gris }}>
          {fmt(r.saldo_a_favor)}
        </strong>
      ),
    },
    {
      key: 'saldo_bsale', label: 'Saldo en BSALE', align: 'right', width: 125,
      render: r => r.saldo_bsale == null
        ? <span style={{ color: '#D1D5DB' }}>sin saldo</span>
        : <strong style={{ color: C.azul2 }}>{fmt(r.saldo_bsale)}</strong>,
    },
    {
      key: 'delta_vs_bsale', label: 'Diferencia', align: 'right', width: 110,
      render: r => {
        const d = Number(r.delta_vs_bsale ?? 0)
        if (Math.abs(d) <= 1000) return <span style={{ color: C.verde, fontSize: 11 }}>calza</span>
        return <span style={{ color: d < 0 ? C.rojo : C.gris, fontWeight: 600 }}>{d > 0 ? '+' : ''}{fmt(d)}</span>
      },
    },
    {
      key: 'estado', label: 'Estado', width: 290,
      render: r => {
        const e = r.estado ?? ''
        const cfg = e.includes('revisar') ? { c: C.rojo, b: C.rojoBg }
          : e.includes('validado') ? { c: C.verde, b: C.verdeBg }
          : e.includes('anterior a dic') ? { c: C.azul2, b: '#DBEAFE' }
          : { c: C.gris, b: C.grisBg }
        return <Chip texto={e} color={cfg.c} bg={cfg.b} />
      },
    },
    {
      key: 'dias_desde_ultima_entrada', label: 'Sin mover', align: 'right', width: 92,
      render: r => r.dias_desde_ultima_entrada == null ? <span style={{ color: '#D1D5DB' }}>—</span> : (
        <span style={{ color: r.dias_desde_ultima_entrada > 365 ? C.rojo : r.dias_desde_ultima_entrada > 180 ? C.naranja : C.gris, fontWeight: 600 }}>
          {r.dias_desde_ultima_entrada} d
        </span>
      ),
    },
    { key: 'n_movimientos', label: 'Movs', align: 'right', width: 65 },
    { key: 'sucursales', label: 'Sucursales', width: 150 },
    { key: 'cliente_email', label: 'Correo', width: 200, render: r => r.cliente_email ?? <span style={{ color: '#D1D5DB' }}>—</span> },
  ], [])

  const SECCIONES = [
    { k: 'resumen', l: 'Resumen' },
    { k: 'movimientos', l: `Movimientos${movs.length ? ` (${movs.length})` : ''}` },
    { k: 'conciliar', l: `Por conciliar${cola.length ? ` (${cola.length})` : ''}` },
    { k: 'clientes', l: `Cuenta por cliente${cuentas.length ? ` (${cuentas.length})` : ''}` },
    { k: 'nc', l: `Notas de crédito${ncs.length ? ` (${ncs.length})` : ''}` },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Filtros ── */}
      <div style={{ ...cardSt, padding: '12px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr)) auto', gap: 10, alignItems: 'end' }}>
        <div>
          <label style={labelSt}>Año</label>
          <select style={selectSt} value={anio} onChange={e => setAnio(Number(e.target.value))}>
            {[hoy.getFullYear(), hoy.getFullYear() - 1].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label style={labelSt}>Mes</label>
          <select style={selectSt} value={mes} onChange={e => setMes(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={labelSt}>Sucursal</label>
          <select style={selectSt} value={sucursalSel} onChange={e => setSucursalSel(e.target.value)}>
            <option value="">Todas</option>
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <button onClick={cargar} disabled={cargando} style={{ ...btnSt('#6B7280'), padding: '8px 14px' }} title="Recargar">
          {cargando ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
        </button>
      </div>

      {/* Frescura: sin esto la pantalla no dice contra qué momento está comparando */}
      {frescura.length > 0 && (
        <div style={{ fontSize: 10, color: C.gris, display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: -8 }}>
          {frescura.map(f => {
            const horas = f.ultima_corrida ? (Date.now() - new Date(f.ultima_corrida).getTime()) / 3600000 : null
            const etiqueta = { payments: 'pagos', returns: 'devoluciones', clients: 'clientes' }[f.recurso] ?? f.recurso
            return (
              <span key={f.recurso} style={{ color: horas != null && horas > 36 ? C.naranja : C.gris }}>
                {etiqueta}: {horas == null ? 'sin datos'
                  : horas < 1 ? 'hace minutos'
                  : horas < 24 ? `hace ${Math.round(horas)} h`
                  : `hace ${Math.round(horas / 24)} d`}
                {f.estado === 'error' && ' · con error'}
              </span>
            )
          })}
        </div>
      )}

      {/* ── Secciones ── */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid rgba(0,0,0,0.06)', overflowX: 'auto' }}>
        {SECCIONES.map(s => (
          <button key={s.k} onClick={() => setSeccion(s.k)} style={{
            padding: '7px 14px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
            background: 'none', border: 'none', cursor: 'pointer',
            color: seccion === s.k ? C.azul : '#8E8E93',
            borderBottom: seccion === s.k ? `2px solid ${C.azul}` : '2px solid transparent',
          }}>{s.l}</button>
        ))}
      </div>

      {/* ═══ RESUMEN ═══ */}
      {seccion === 'resumen' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <Kpi label="Venta del período" valor={fmt(resumen.venta)} />
            <Kpi label="Recaudación" valor={fmt(resumen.recaudacion)} color={C.verde}
              sub={`Desvío ${pct1(resumen.desvio, resumen.venta)}%`} />
            <Kpi label="Movimientos de abono" valor={resumen.movTotal || movs.length}
              sub={`${resumen.movConc || 0} identificados`} />
            <Kpi label="Pendiente de identificar"
              valor={fmtC(tramos.porConfirmar + tramos.porRevisar + tramos.sinMatch)}
              color={C.naranja} alerta={tramos.sinMatch > 0}
              sub={tramos.sinMatch > 0 ? `${fmtC(tramos.sinMatch)} sin candidato` : 'todos con candidato'} />
            <Kpi label="NC sin destino registrado" valor={fmtC(resumen.ncSinExplicar)}
              color={resumen.ncSinExplicar > 0 ? C.rojo : C.verde} alerta={resumen.ncSinExplicar > 0}
              sub={`${resumen.nNcSinExplicar} nota${resumen.nNcSinExplicar !== 1 ? 's' : ''} de crédito`} />
          </div>

          <BarraConciliacion {...tramos} />

          {/* Los cuatro movimientos */}
          <div style={{ ...cardSt, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.gris, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              Los cuatro movimientos del abono
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
              {Object.entries(MOVIMIENTOS).map(([k, m]) => {
                const d = porMovimiento[k] ?? { n: 0, monto: 0, conciliado: 0 }
                const Ic = m.ic
                return (
                  <div key={k} style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: m.color, fontWeight: 700, fontSize: 12 }}>
                      <Ic size={13} /> {m.l}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: C.texto, marginTop: 4 }}>{fmt(d.monto)}</div>
                    <div style={{ fontSize: 10, color: C.gris, marginTop: 2 }}>
                      {d.n} movimiento{d.n !== 1 ? 's' : ''} · {pct1(d.conciliado, d.monto)}% identificado
                    </div>
                    <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 5, lineHeight: 1.35 }}>{m.desc}</div>
                  </div>
                )
              })}
            </div>
            <div style={{ fontSize: 10, color: C.gris, marginTop: 10, borderTop: '1px solid #F1F5F9', paddingTop: 8, lineHeight: 1.45 }}>
              BSALE mantiene una sola bolsa de crédito por cliente. El medio con que se consume
              (Abono cliente o NC) no indica de dónde vino el saldo: lo que entra por nota de
              crédito puede salir como abono y viceversa.
            </div>
          </div>

          {/* Ciclo de vida del crédito nacido de notas de crédito */}
          {(resumen.credVigente + resumen.credConsumido + resumen.credSinCliente + resumen.credReverso) > 0 && (
            <div style={{ ...cardSt, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.gris, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                Dónde terminó el crédito que nació de notas de crédito
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
                {[
                  { l: 'Consumido en una compra', v: resumen.credConsumido, c: C.verde, d: 'el cliente volvió y lo usó' },
                  { l: 'Vigente a favor del cliente', v: resumen.credVigente, c: C.azul2, d: 'validado contra el saldo de BSALE' },
                  { l: 'Sin cliente registrado', v: resumen.credSinCliente, c: C.gris, d: 'boleta sin cliente: no se puede seguir' },
                  { l: 'Devuelto a la tarjeta', v: resumen.credReverso, c: C.rojo, d: 'salió por Getnet/Transbank, no es crédito' },
                ].filter(x => x.v > 0).map(x => (
                  <div key={x.l} style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: x.c }}>{x.l}</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: C.texto, marginTop: 3 }}>{fmt(x.v)}</div>
                    <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 3, lineHeight: 1.35 }}>{x.d}</div>
                  </div>
                ))}
              </div>
              {resumen.credReverso > 0 && (
                <div style={{ marginTop: 10, background: C.rojoBg, borderRadius: 7, padding: '9px 12px', fontSize: 11, color: '#991B1B', display: 'flex', gap: 7 }}>
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    {resumen.nReverso} devolución{resumen.nReverso !== 1 ? 'es' : ''} por {fmt(resumen.credReverso)} sobre
                    compras pagadas con tarjeta, donde el cliente quedó sin saldo: la plata volvió al medio de pago.
                    BSALE lo registra como crédito, pero es salida de dinero y debe aparecer en la liquidación de Getnet o Transbank.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Notas de crédito por efecto */}
          <div style={{ ...cardSt, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.gris, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              Notas de crédito por efecto sobre la plata
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {[
                { l: 'Crédito generado', v: resumen.ncCredito, c: C.azul2, d: 'quedó como saldo del cliente' },
                { l: 'Devolución de dinero', v: resumen.ncDinero, c: C.rojo, d: 'salió plata del cajón' },
                { l: 'Anulación', v: resumen.ncAnulacion, c: C.gris, d: 'no hubo plata' },
                { l: 'Sin destino registrado', v: resumen.ncSinExplicar, c: C.naranja, d: 'el cliente había pagado' },
              ].map(x => (
                <div key={x.l} style={{ background: '#F9FAFB', borderRadius: 8, padding: '9px 13px', minWidth: 170 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: x.c }}>{x.l}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.texto, marginTop: 2 }}>{fmt(x.v)}</div>
                  <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1 }}>{x.d}</div>
                </div>
              ))}
            </div>
            {resumen.ncSinExplicar > 0 && (
              <div style={{ marginTop: 10, background: C.naranjaBg, borderRadius: 7, padding: '9px 12px', fontSize: 11, color: '#92400E', display: 'flex', gap: 7 }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  Hay {resumen.nNcSinExplicar} nota{resumen.nNcSinExplicar !== 1 ? 's' : ''} de crédito
                  por {fmt(resumen.ncSinExplicar)} sobre documentos que el cliente ya había pagado,
                  sin registro de qué recibió a cambio: ni crédito, ni devolución en efectivo, ni
                  anulación de deuda. Revísalas en la pestaña Notas de crédito.
                </span>
              </div>
            )}
          </div>

          {/* Flujo por sucursal */}
          {pasivo.length > 0 && (
            <div style={{ ...cardSt, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.gris, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Flujo del año por sucursal
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#F9FAFB' }}>
                    {['Sucursal', 'Entra plata', 'Entra por NC', 'Se imputa', 'Neto', 'Sin identificar'].map((h, i) => (
                      <th key={h} style={{ padding: '7px 10px', fontSize: 10, fontWeight: 600, color: C.gris, textAlign: i === 0 ? 'left' : 'right', borderBottom: '1px solid #E5E7EB' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pasivo.map(p => (
                    <tr key={p.sucursal_id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '7px 10px', fontWeight: 600 }}>{p.sucursal_id}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{fmt(p.entrada_plata)}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{fmt(p.entrada_nc)}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right' }}>{fmt(Number(p.aplicado_plata ?? 0) + Number(p.aplicado_nc ?? 0))}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: Number(p.saldo_estimado) >= 0 ? C.verde : C.naranja }}>
                        {fmt(p.saldo_estimado)}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: Number(p.sin_identificar) > 0 ? C.naranja : C.gris }}>
                        {fmt(p.sin_identificar)} <span style={{ fontSize: 10, color: '#9CA3AF' }}>({p.n_sin_identificar})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 10, color: C.gris, marginTop: 8, lineHeight: 1.45 }}>
                Neto del año, no saldo acumulado. Lo que entra y lo que se imputa deben tender a
                compensarse: si el neto se dispara, se está recibiendo plata que no se está imputando.
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══ MOVIMIENTOS ═══ */}
      {seccion === 'movimientos' && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: C.gris, fontWeight: 600 }}>Movimiento:</span>
            <button onClick={() => setFiltroMov('')} style={{ ...btnOutlineSt, padding: '3px 10px', fontSize: 11, ...(filtroMov === '' ? { background: C.azul, color: '#fff', borderColor: C.azul } : {}) }}>Todos</button>
            {Object.entries(MOVIMIENTOS).map(([k, m]) => (
              <button key={k} onClick={() => setFiltroMov(k)}
                style={{ ...btnOutlineSt, padding: '3px 10px', fontSize: 11, ...(filtroMov === k ? { background: m.color, color: '#fff', borderColor: m.color } : {}) }}>
                {m.l}
              </button>
            ))}
          </div>
          <DataGrid
            columns={colsMov} rows={movs} getRowId={r => r.pago_id}
            title="Libro mayor de abonos" exportName={`abonos_${anio}_${mes || 'año'}`}
            loading={cargando} emptyText="Sin movimientos de abono en el período" />
        </>
      )}

      {/* ═══ POR CONCILIAR ═══ */}
      {seccion === 'conciliar' && (
        <>
          <div style={{ ...cardSt, padding: '12px 16px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: C.texto, flex: 1, minWidth: 260, lineHeight: 1.5 }}>
              <strong>Entradas de plata sin cliente identificado.</strong> BSALE no expone el cliente
              del comprobante de abono en su API, así que estas transacciones existen y están cuadradas
              en caja, pero no sabemos a quién pertenece el saldo. Identificarlas permite reclamar o
              cerrar el compromiso con cada cliente.
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.naranja }}>
                {fmt(cola.reduce((a, r) => a + Number(r.monto ?? 0), 0))}
              </div>
              <div style={{ fontSize: 10, color: C.gris }}>{cola.length} entradas pendientes</div>
            </div>
          </div>
          <DataGrid
            columns={colsCola} rows={cola} getRowId={r => r.pago_id}
            title="Abonos por identificar" exportName="abonos_por_conciliar"
            loading={cargando} emptyText="No hay abonos pendientes de identificar" />
        </>
      )}

      {/* ═══ CUENTA POR CLIENTE ═══ */}
      {seccion === 'clientes' && (
        <>
          <div style={{ ...cardSt, padding: '12px 16px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: 12, color: C.texto, flex: 1, minWidth: 260, lineHeight: 1.5 }}>
              <strong>Cuenta corriente de cada cliente, contrastada contra BSALE.</strong> El libro
              parte en diciembre 2025, así que un saldo mayor en BSALE es crédito anterior y es
              normal. Lo que exige revisión es lo contrario: que el libro muestre saldo y BSALE
              diga cero. La columna <em>Sin mover</em> señala a quién contactar para que retire.
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.azul2 }}>
                {fmt(cuentas.reduce((a, c) => a + Number(c.saldo_bsale ?? 0), 0))}
              </div>
              <div style={{ fontSize: 10, color: C.gris }}>
                a favor según BSALE, en {cuentas.filter(c => Number(c.saldo_bsale ?? 0) > 0).length} clientes
              </div>
              {(() => {
                const rev = cuentas.filter(c => (c.estado ?? '').includes('revisar'))
                return rev.length > 0 ? (
                  <div style={{ fontSize: 10, color: C.rojo, marginTop: 3, fontWeight: 600 }}>
                    {rev.length} requieren revisión · {fmt(rev.reduce((a, c) => a + Math.abs(Number(c.delta_vs_bsale ?? 0)), 0))}
                  </div>
                ) : null
              })()}
            </div>
          </div>
          <DataGrid
            columns={colsCuenta} rows={cuentas} getRowId={r => r.cliente_id}
            title="Cuenta corriente de abonos por cliente" exportName="abonos_por_cliente"
            loading={cargando} emptyText="Sin clientes con movimientos de abono" />
        </>
      )}

      {/* ═══ NOTAS DE CRÉDITO ═══ */}
      {seccion === 'nc' && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: C.gris, fontWeight: 600 }}>Efecto:</span>
            <button onClick={() => setFiltroEfecto('')} style={{ ...btnOutlineSt, padding: '3px 10px', fontSize: 11, ...(filtroEfecto === '' ? { background: C.azul, color: '#fff', borderColor: C.azul } : {}) }}>Todas</button>
            {Object.entries(EFECTOS_NC).map(([k, e]) => (
              <button key={k} onClick={() => setFiltroEfecto(k)}
                style={{ ...btnOutlineSt, padding: '3px 10px', fontSize: 11, ...(filtroEfecto === k ? { background: e.color, color: '#fff', borderColor: e.color } : {}) }}>
                {e.l}
              </button>
            ))}
          </div>
          {filtroEfecto === 'sin_efecto_registrado' && (
            <div style={{ background: C.naranjaBg, borderRadius: 8, padding: '10px 14px', fontSize: 11, color: '#92400E', lineHeight: 1.5 }}>
              El cliente pagó, devolvió la mercadería, y el sistema no registra qué recibió a cambio.
              Toda nota de crédito sobre un documento pagado debería terminar en crédito a favor,
              devolución en efectivo o cambio de producto. Estas no tienen ninguno de los tres.
            </div>
          )}
          <DataGrid
            columns={colsNc} rows={ncs} getRowId={r => r.bsale_id}
            title="Notas de crédito" exportName={`nc_${anio}_${mes || 'año'}`}
            loading={cargando} emptyText="Sin notas de crédito en el período" />
        </>
      )}

      {asignando && (
        <PanelAsignacion entrada={asignando} onCerrar={() => setAsignando(null)}
          onAsignado={() => { setAsignando(null); cargar() }} />
      )}
    </div>
  )
}
