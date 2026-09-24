// CierreDelDiaTab.jsx — Módulo unificado de cierre de caja con BSALE
// Reemplaza DeclararCierreTab + CorroborarCierresTab
import { Fragment, useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { Loader2, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, X, CheckCircle2, AlertTriangle, AlertCircle, RefreshCw, Landmark, Trash2, Plus } from 'lucide-react'
import { supabase } from '../../supabase'
import { preloadCaps, canSync, userScopeSync } from '../../core/permisos'
import { MEDIOS, UMBRALES_DEFAULT, formatCLP, parseCLP, todayISO, inputSt, selectSt, labelSt, cardSt, btnSt, btnOutlineSt, estadoBadge, clasificarPorDiferencia } from './types'
import {
  fetchSucursales, fetchUmbrales, fetchCierreDelDia, declararCierre, actualizarDeclaracion, corroborarCierre, editarCierreAdmin,
  fetchConfigTesoreria, syncPagosIncremental, fetchCierresEsperadosDia, fetchRetiros, crearRetiro, eliminarRetiro,
  fetchPuenteBsale, fetchFrescuraLedger,
} from './api'

// RBAC-4: PUEDE_VER_TODAS reemplazado por canSync(cu, 'finanzas', 'fin.teso.cierre.ver_todas')

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(n) { return n == null ? '—' : formatCLP(n) }

function BrechaChip({ valor, umbrales }) {
  if (valor == null) return <span style={{ color: '#9CA3AF', fontSize: 12 }}>—</span>
  const abs = Math.abs(valor)
  const ok = abs <= umbrales.cuadra
  const tol = abs <= umbrales.tolerable
  const color = ok ? '#16A34A' : tol ? '#D97706' : '#DC2626'
  const bg = ok ? '#DCFCE7' : tol ? '#FEF9C3' : '#FEE2E2'
  const Icon = ok ? CheckCircle2 : tol ? AlertCircle : AlertTriangle
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, background: bg, color, fontSize: 12, fontWeight: 600 }}>
      <Icon size={11} />
      {fmt(valor)}
    </span>
  )
}

function MoneyInput({ value, onChange, disabled }) {
  const [text, setText] = useState(value ? formatCLP(value) : '')
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(value ? formatCLP(value) : '') }, [value, focused])
  return (
    <input type="text" inputMode="numeric" disabled={disabled} placeholder="$0" value={text}
      style={{ ...inputSt, textAlign: 'right', fontSize: 12, background: disabled ? '#F9FAFB' : '#fff' }}
      onFocus={e => { setFocused(true); setText(value ? String(value) : ''); setTimeout(() => e.target.select(), 0) }}
      onChange={e => { setText(e.target.value); onChange(parseCLP(e.target.value)) }}
      onBlur={() => { setFocused(false); setText(value ? formatCLP(value) : '') }}
    />
  )
}

// ── Fetch BSALE: cache-first, edge function como fallback ──────────────────
async function fetchBsaleDia(fecha, sucursal_id, forzar = false) {
  try {
    // 1) Si no se fuerza, intentar leer de la cache (instantáneo)
    if (!forzar) {
      const { data: cached } = await supabase
        .from('ventas_bsale_dia')
        .select('total_venta, total_nc, docs_venta, docs_nc, medios, por_recaudador, por_vendedor, sincronizado_at')
        .eq('fecha', fecha)
        .eq('sucursal_id', sucursal_id)
        .maybeSingle()
      if (cached && cached.por_recaudador) {
        return {
          total_venta: cached.total_venta,
          medios_global: cached.medios ?? {},
          por_recaudador: cached.por_recaudador ?? [],
          por_vendedor: cached.por_vendedor ?? [],
          docs_sucursal: cached.docs_venta ?? 0,
          fecha, sucursal_id,
          desde_cache: true,
          sincronizado_at: cached.sincronizado_at,
        }
      }
    }
    // 2) Sin cache o forzando: llamar edge function (la guarda en cache)
    const { data: { session } } = await supabase.auth.getSession()
    const headers = { 'Content-Type': 'application/json' }
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bsale-ventas-dia`,
      { method: 'POST', headers, body: JSON.stringify({ fecha, sucursal_id }) }
    )
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    console.warn('[fetchBsaleDia]', e.message)
    return null
  }
}

// ── Helpers F2 · base caja física ──────────────────────────────────────────
const N = v => Number(v ?? 0)
const RETIRO_DESTINOS = [
  { value: 'caja_fuerte', label: 'Caja fuerte' },
  { value: 'deposito',    label: 'Depósito directo' },
  { value: 'otro',        label: 'Otro' },
]
function fmtHora(ts) {
  if (!ts) return '—'
  try { return new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false }) } catch { return '—' }
}

// Referencia bajo cada input: lo que el ledger de pagos BSALE espera para ese medio.
// Si el declarado difiere, muestra el delta — es la señal que el cajero necesita ver.
// `onUsar` solo se ofrece en medios electrónicos: el efectivo se cuenta, no se copia.
function Esperado({ valor, declarado, onUsar }) {
  if (valor == null) return null
  const dif = declarado != null ? declarado - valor : null
  const hayDif = dif != null && dif !== 0 && declarado !== 0
  return (
    <div style={{ fontSize: 10, marginTop: 2, textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'baseline' }}>
      {onUsar && valor > 0 && declarado === 0 && (
        <button onClick={() => onUsar(valor)} type="button"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#4F46E5', fontSize: 10, fontWeight: 600 }}>
          usar
        </button>
      )}
      <span style={{ color: '#6B7280' }}>
        esperado <span style={{ fontWeight: 600, color: '#374151' }}>{fmt(valor)}</span>
      </span>
      {hayDif && (
        <span style={{ fontWeight: 700, color: Math.abs(dif) > 1000 ? '#DC2626' : '#D97706' }}>
          {dif > 0 ? '+' : ''}{fmt(dif)}
        </span>
      )}
    </div>
  )
}

// Retiros de efectivo del día (traslado a caja fuerte / depósito antes de cerrar).
// Contablemente es activo→activo: no cambia la recaudación, cambia dónde está la plata.
// Suma a la caja declarada para compararla con el esperado.
function RetirosBlock({ retiros, onAgregar, onEliminar, editable, titulo = 'Retiros de efectivo del día' }) {
  const [monto, setMonto] = useState(0)
  const [destino, setDestino] = useState('caja_fuerte')
  const [comprobante, setComprobante] = useState('')
  const [nota, setNota] = useState('')
  const [adding, setAdding] = useState(false)
  const total = retiros.reduce((s, r) => s + N(r.monto), 0)

  async function agregar() {
    if (!monto || monto <= 0) { toast.error('Ingresa el monto del retiro'); return }
    setAdding(true)
    try {
      await onAgregar({ monto, destino, comprobante: comprobante.trim() || null, nota: nota.trim() || null })
      setMonto(0); setComprobante(''); setNota('')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Error al registrar retiro') }
    finally { setAdding(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <Landmark size={13} /> {titulo}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700 }}>{fmt(total)}</div>
      </div>
      <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '8px 10px' }}>
        {retiros.length === 0 && (
          <div style={{ fontSize: 11, color: '#9CA3AF', padding: '2px 0' }}>
            Sin retiros. Si trasladaste efectivo a caja fuerte o lo depositaste antes de cerrar, regístralo aquí: suma a tu caja declarada.
          </div>
        )}
        {retiros.map((r, i) => (
          <div key={r.id ?? `p${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '0.5px solid #E5E7EB', fontSize: 11 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
              <span style={{ color: '#6B7280' }}>{fmtHora(r.hora)}</span>
              <span style={{ background: '#EEF2FF', color: '#3730A3', padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600 }}>
                {RETIRO_DESTINOS.find(d => d.value === r.destino)?.label ?? r.destino}
              </span>
              {r.comprobante && <span style={{ color: '#374151' }}>#{r.comprobante}</span>}
              {r.nota && (
                <span title={r.nota} style={{ color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{r.nota}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontWeight: 600 }}>{fmt(N(r.monto))}</span>
              {editable && (
                <button onClick={() => onEliminar(r)} title="Quitar retiro"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 2, display: 'flex' }}>
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
        {editable && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8, alignItems: 'end' }}>
            <div>
              <label style={{ ...labelSt, marginBottom: 2, fontSize: 10 }}>Monto</label>
              <MoneyInput value={monto} onChange={setMonto} />
            </div>
            <div>
              <label style={{ ...labelSt, marginBottom: 2, fontSize: 10 }}>Destino</label>
              <select style={{ ...selectSt, fontSize: 12 }} value={destino} onChange={ev => setDestino(ev.target.value)}>
                {RETIRO_DESTINOS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ ...labelSt, marginBottom: 2, fontSize: 10 }}>Comprobante</label>
              <input style={{ ...inputSt, fontSize: 12 }} value={comprobante} onChange={ev => setComprobante(ev.target.value)} placeholder="N° depósito / boleta (opcional)" />
            </div>
            <div>
              <label style={{ ...labelSt, marginBottom: 2, fontSize: 10 }}>Nota</label>
              <input style={{ ...inputSt, fontSize: 12 }} value={nota} onChange={ev => setNota(ev.target.value)} placeholder="opcional" />
            </div>
            <button onClick={agregar} disabled={adding}
              style={{ ...btnSt('#374151'), gridColumn: '1 / -1', justifyContent: 'center', opacity: adding ? 0.6 : 1 }}>
              {adding ? <Loader2 size={13} /> : <Plus size={13} />} Agregar retiro
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Estado del ARQUEO con su monto. Sin el monto, $30 de sencillo y un faltante de
// $2.000.000 se veían idénticos en la lista. El eje del arqueo (tesorero vs cajero)
// es distinto del de la brecha de caja (cajero vs BSALE): por eso la columna se llama
// "Arqueo" y no "Estado".
function ArqueoChip({ cierre }) {
  if (!cierre) return <span style={{ fontSize: 11, color: '#9CA3AF' }}>Sin cierre</span>
  const dif = Number(cierre.efectivo_corrob ?? 0) - Number(cierre.efectivo ?? 0)
  const pendiente = cierre.estado === 'declarado'
  return (
    <span style={{ display: 'inline-flex', gap: 5, alignItems: 'baseline', whiteSpace: 'nowrap' }}>
      {estadoBadge(cierre.estado)}
      {!pendiente && dif !== 0 && (
        <span style={{ fontSize: 10, fontWeight: 600, color: Math.abs(dif) > 20000 ? '#991B1B' : '#6B7280' }}
          title="Diferencia entre el efectivo contado por tesorería y el declarado por el cajero">
          {dif > 0 ? '+' : ''}{fmt(dif)}
        </span>
      )}
    </span>
  )
}

// ── Panel declaración de un vendedor ───────────────────────────────────────
// rigeCaja (fecha ≥ cut-off teso_caja_fisica_desde): el arqueo compara contra la
// CAJA FÍSICA ESPERADA (ledger de pagos BSALE), que es lo percibido. La venta contable
// es lo devengado y se muestra solo como referencia con el puente entre ambas.
// abono_cliente deja de ser un campo del cajero: no es plata, es la cancelación de un
// anticipo; se toma del ledger y se guarda como informativo.
// ── Cobertura del ledger ─────────────────────────────────────────────────
// Lo que BSALE vendió al cajero debe estar cubierto por pagos en el ledger:
// caja (sin anticipos) + abono aplicado + NC aplicada + crédito + excepciones.
// Si falta más que la tolerancia, el ledger está incompleto (pagos no
// sincronizados) y la "caja esperada" es falsa. Validado sobre todo 2026:
// detecta los casos reales (21-09, 121 pagos perdidos) y da 0 falsos positivos.
// Lo contrario (cubierto > venta) es normal: cobros de ventas de otros días.
function coberturaLedger(esp) {
  if (!esp || esp.venta_contable == null) return null
  const venta = N(esp.venta_contable)
  const cubierto = N(esp.caja_bruta) - N(esp.abonos_recibidos) + N(esp.abono_aplicado)
    + N(esp.nc_aplicada) + N(esp.credito_cxc) + N(esp.admin_excepcion)
  const faltante = venta - cubierto
  const umbral = Math.max(1000, Math.abs(venta) * 0.005)
  return { venta, cubierto, faltante, incompleto: faltante > umbral }
}

function PanelDeclaracion({ vendedorBsale, cierre, sucursalId, fecha, usuario, umbrales, onGuardado, vendedorReal, rigeCaja, esperado, onSync, syncing, esHoy, syncHaceMin }) {
  const [valores, setValores] = useState(() => {
    if (cierre) return MEDIOS.reduce((a, m) => ({ ...a, [m.key]: Number(cierre[m.key] ?? 0) }), {})
    return MEDIOS.reduce((a, m) => ({ ...a, [m.key]: 0 }), {})
  })
  const [obs, setObs] = useState(cierre?.observaciones_vendedor ?? '')
  const [saving, setSaving] = useState(false)
  const [otrosOpen, setOtrosOpen] = useState(false)
  // Retiros: persistidos si el cierre existe; pendientes (locales) hasta firmar
  const [retiros, setRetiros] = useState([])
  const [retirosPend, setRetirosPend] = useState([])

  useEffect(() => {
    if (cierre?.id) fetchRetiros(cierre.id).then(setRetiros).catch(() => setRetiros([]))
    else setRetiros([])
  }, [cierre?.id])

  const esReadOnly = cierre && cierre.estado !== 'declarado'
  const esp = rigeCaja ? esperado : null
  // El modo caja solo opera con ledger disponible. Sin él NO se puede calcular la caja
  // esperada, así que se degrada a declaración libre (todos los campos, nada sobreescrito):
  // es preferible un cierre en base venta que perder lo que el cajero declaró.
  // Ledger incompleto = faltan pagos que BSALE sí registró. Se trata igual que sin
  // ledger: se degrada a base venta y no se sobreescribe nada, porque firmar contra
  // una caja esperada incompleta acusaría un faltante que no existe.
  const cobertura = coberturaLedger(esp)
  const ledgerIncompleto = !!cobertura?.incompleto
  const cajaOperativa = rigeCaja && !!esp && !ledgerIncompleto
  const sinLedger = rigeCaja && !esp
  const abonoAplicadoLedger = esp ? N(esp.abono_aplicado) : null
  // Frescura: lo que importa es cuándo corrió el SYNC, no cuándo vendió este cajero
  // (un cajero puede no vender en horas y el ledger estar al día). Solo aplica a hoy:
  // para un día pasado la pregunta es si el ledger está completo, no si está fresco.
  const syncViejo = esHoy && syncHaceMin != null && syncHaceMin > 45
  // Los esperados vienen del ledger, que se actualiza con un sync al abrir el día.
  // Si cambian cuando el cajero YA empezó a digitar, se le avisa explícitamente:
  // sus montos no se tocan, pero las diferencias bajo cada medio sí cambian.
  // (21-09: las sugerencias "cambiaban solas" y nadie sabía por qué.)
  const espPrevRef = useRef(null)
  const [avisoCambio, setAvisoCambio] = useState(null)
  useEffect(() => {
    const actual = esp ? N(esp.caja_esperada) : null
    const anterior = espPrevRef.current
    const yaDigito = Object.values(valores).some(v => Number(v) > 0)
    if (anterior != null && actual != null && anterior !== actual && yaDigito) {
      setAvisoCambio(a => ({ antes: a?.antes ?? anterior, ahora: actual }))
    }
    espPrevRef.current = actual
  }, [esp?.caja_esperada])  // eslint-disable-line react-hooks/exhaustive-deps

  // Bajo base caja, abono_cliente y canje no son plata: quedan fuera de la suma
  const KEYS_CAJA = MEDIOS.map(m => m.key).filter(k => !['abono_cliente', 'canje'].includes(k))
  const totalMedios = useMemo(() => MEDIOS.reduce((s, m) => s + (valores[m.key] || 0), 0), [valores])
  const todosRetiros = useMemo(() => [...retiros, ...retirosPend], [retiros, retirosPend])
  const totalRetiros = todosRetiros.reduce((s, r) => s + N(r.monto), 0)
  const plataDeclarada = useMemo(() => KEYS_CAJA.reduce((s, k) => s + (valores[k] || 0), 0), [valores])
  const cajaDeclarada = plataDeclarada + totalRetiros

  const ventaContable = vendedorBsale?.venta ?? (esp?.venta_contable != null ? N(esp.venta_contable) : null)
  const cajaEsperada = esp ? N(esp.caja_esperada) : null
  const brechaVenta = ventaContable != null ? totalMedios - ventaContable : null
  const brecha = cajaOperativa ? (cajaEsperada != null ? cajaDeclarada - cajaEsperada : null) : brechaVenta

  // Puente venta → caja (todas las líneas en signo "ajuste sobre la venta")
  const puente = esp && ventaContable != null ? (() => {
    const abonoApl = -N(esp.abono_aplicado), cxc = -N(esp.credito_cxc), excep = -N(esp.admin_excepcion)
    const recibidos = N(esp.abonos_recibidos), devol = -N(esp.devoluciones_dinero)
    const otros = cajaEsperada - ventaContable - (abonoApl + cxc + excep + recibidos + devol)
    return [
      ['Abonos aplicados (anticipos usados; no es caja)', abonoApl],
      ['Venta a crédito CxC (no es caja)', cxc],
      ['Excepciones administrativas', excep],
      ['Anticipos recibidos hoy (es caja; no es venta)', recibidos],
      ['Devoluciones en dinero (salieron del cajón)', devol],
      [otros < 0 && ledgerIncompleto
        ? 'Pagos que BSALE registra y no están en el ledger'
        : 'Cobros de otros días / otros', otros],
    ].filter(([, v]) => v !== 0)
  })() : []

  const MEDIOS_PPAL = MEDIOS.filter(m => ['efectivo', 't_credito', 't_debito', 'webpay', 'transferencia'].includes(m.key))
  const MEDIOS_OTROS = MEDIOS.filter(m => !['efectivo', 't_credito', 't_debito', 'webpay', 'transferencia'].includes(m.key) && !(cajaOperativa && m.key === 'abono_cliente'))
  const esperadoPorMedio = esp ? {
    efectivo: N(esp.efectivo), t_credito: N(esp.t_credito), t_debito: N(esp.t_debito),
    webpay: N(esp.webpay), transferencia: N(esp.transferencia), m_pago: N(esp.m_pago), cheque: N(esp.cheque), p_clay: N(esp.p_clay),
  } : {}

  async function agregarRetiro(r) {
    if (cierre?.id) {
      await crearRetiro({ cierre_id: cierre.id, fecha, sucursal_id: sucursalId, ...r })
      setRetiros(await fetchRetiros(cierre.id))
    } else {
      setRetirosPend(p => [...p, { ...r, hora: new Date().toISOString() }])
    }
  }
  async function quitarRetiro(r) {
    if (r.id) { await eliminarRetiro(r.id); setRetiros(await fetchRetiros(cierre.id)) }
    else setRetirosPend(p => p.filter(x => x !== r))
  }

  async function guardar() {
    if (!sucursalId) { toast.error('Selecciona una sucursal'); return }
    setAvisoCambio(null)
    // Control interno: una brecha mayor a lo tolerable no se firma sin explicación.
    if (brecha != null && Math.abs(brecha) > umbrales.tolerable && obs.trim() === '') {
      toast.error(`La diferencia es de ${fmt(brecha)}. Explica el motivo en Observaciones antes de firmar.`)
      return
    }
    setSaving(true)
    try {
      const payload = {
        fecha, sucursal_id: sucursalId, vendedor_id: (vendedorReal?.id || usuario.id),
        // Guardar el ID del recaudador BSALE: es el match confiable con por_recaudador.
        // Sin esto el cruce depende solo del nombre y genera filas huérfanas.
        bsale_vendedor_id: vendedorBsale?.bsale_user_id ?? null,
        observaciones_vendedor: obs.trim() || null,
        venta_bsale_api: ventaContable,
        base_comparacion: cajaOperativa ? 'caja' : 'venta',
        ...valores,
      }
      if (cajaOperativa) {
        Object.assign(payload, {
          caja_esperada_api: cajaEsperada,
          // No es plata: se toma del ledger (mantiene comparable la base venta histórica)
          abono_cliente: abonoAplicadoLedger ?? 0,
          // Anticipos de clientes recibidos hoy por este cajero (pasivo), según ledger
          abonos_rec_efectivo: N(esp.abonos_rec_efectivo),
          abonos_rec_debito:   N(esp.abonos_rec_tarjeta),
          abonos_rec_otros:    N(esp.abonos_rec_otros),
          abonos_rec_nota:     esp.ultimo_pago_at ? `Ledger BSALE al ${esp.ultimo_pago_at}` : null,
        })
      }
      const result = cierre?.id
        ? await actualizarDeclaracion(cierre.id, payload)
        : await declararCierre(payload)
      // Persistir los retiros acumulados antes de firmar
      if (!cierre?.id && retirosPend.length > 0) {
        for (const r of retirosPend) await crearRetiro({ cierre_id: result.id, fecha, sucursal_id: sucursalId, ...r })
        setRetirosPend([])
      }
      toast.success('Cierre guardado')
      onGuardado(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Cabecera base caja: Venta contable vs Caja física esperada + puente */}
      {rigeCaja && (
        <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1a2f4a 100%)', borderRadius: 10, padding: '14px 16px', color: '#fff' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Venta contable</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(ventaContable)}</div>
              <div style={{ fontSize: 10, opacity: 0.6 }}>
                {vendedorBsale?.docs_venta ?? 0} doc{(vendedorBsale?.docs_venta ?? 0) !== 1 ? 's' : ''}
                {vendedorBsale?.nc > 0 ? ` · NC −${fmt(vendedorBsale.nc)}` : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Caja física esperada</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#86EFAC' }}>{esp ? fmt(cajaEsperada) : '—'}</div>
              <div style={{ fontSize: 10, opacity: 0.6 }}>
                {esp ? `${esp.n_pagos} pago${N(esp.n_pagos) !== 1 ? 's' : ''} · ledger ${fmtHora(esp.ultimo_pago_at)}` : 'sin pagos en el ledger'}
              </div>
            </div>
          </div>
          {puente.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.15)', fontSize: 11, display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 2, columnGap: 12 }}>
              {puente.map(([l, v]) => (
                <Fragment key={l}>
                  <span style={{ opacity: 0.75 }}>{l}</span>
                  <span style={{ textAlign: 'right', fontFamily: 'monospace' }}>{v > 0 ? '+' : ''}{fmt(v)}</span>
                </Fragment>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={onSync} disabled={syncing} title="Traer los últimos pagos registrados en BSALE"
              style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 6, padding: '3px 8px', fontSize: 10, cursor: 'pointer', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <RefreshCw size={10} style={syncing ? { animation: 'spin 1s linear infinite' } : undefined} /> Actualizar ledger
            </button>
          </div>
        </div>
      )}

      {/* Cabecera base venta (fechas anteriores al cut-off): comportamiento histórico */}
      {!rigeCaja && vendedorBsale && (
        <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1a2f4a 100%)', borderRadius: 10, padding: '14px 16px', color: '#fff' }}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Venta atribuida BSALE
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{fmt(vendedorBsale.venta)}</div>
              <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                {vendedorBsale.docs_venta} doc{vendedorBsale.docs_venta !== 1 ? 's' : ''}
                {vendedorBsale.nc > 0 && ` · NC: -${fmt(vendedorBsale.nc)}`}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
              {Object.entries(vendedorBsale.modalidades ?? {})
                .sort(([, a], [, b]) => Number(b) - Number(a))
                .slice(0, 4)
                .map(([medio, amt]) => (
                  <div key={medio} style={{ fontSize: 10, opacity: 0.8 }}>
                    {medio.split(' ').slice(0, 2).join(' ')}: {fmt(Number(amt))}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Aviso: base caja sin ledger disponible → declaración libre, nada se sobreescribe */}
      {sinLedger && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#991B1B' }}>
          No hay pagos en el ledger para este cajero en la fecha. Declara normalmente — el cierre se guarda en base venta y Tesorería podrá recalcularlo cuando el ledger se actualice.
        </div>
      )}
      {syncing && rigeCaja && (
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#1E40AF', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
          Trayendo los últimos pagos de BSALE… Los montos esperados pueden cambiar en unos segundos; espera antes de usar las sugerencias o firmar.
        </div>
      )}
      {avisoCambio && !syncing && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '9px 12px', fontSize: 11, color: '#92400E', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span>
            <strong>Los esperados se actualizaron</strong> con pagos nuevos de BSALE: caja esperada {fmt(avisoCambio.antes)} → {fmt(avisoCambio.ahora)}.
            {' '}<strong>Tus montos no cambiaron.</strong> Revisa las diferencias bajo cada medio antes de firmar.
          </span>
          <button onClick={() => setAvisoCambio(null)} type="button"
            style={{ ...btnOutlineSt, padding: '3px 9px', fontSize: 10, color: '#92400E', borderColor: '#FDE68A', whiteSpace: 'nowrap' }}>
            Entendido
          </button>
        </div>
      )}
      {ledgerIncompleto && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '9px 12px', fontSize: 11, color: '#991B1B', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span>
            <strong>Faltan pagos en el ledger.</strong> BSALE registra {fmt(cobertura.venta)} en ventas de este cajero
            y el ledger solo cubre {fmt(cobertura.cubierto)} — faltan {fmt(cobertura.faltante)}.
            La caja esperada está incompleta: actualiza antes de firmar. Si no se corrige, el cierre se guarda en base venta.
          </span>
          <button onClick={onSync} disabled={syncing} type="button"
            style={{ ...btnOutlineSt, padding: '4px 9px', fontSize: 10, color: '#991B1B', borderColor: '#FECACA', whiteSpace: 'nowrap' }}>
            {syncing ? 'Actualizando…' : 'Actualizar ledger'}
          </button>
        </div>
      )}
      {cajaOperativa && syncViejo && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#92400E', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span>La sincronización de pagos no corre hace {syncHaceMin >= 120 ? `${Math.round(syncHaceMin / 60)} h` : `${Math.round(syncHaceMin)} min`}. Si hubo ventas después, actualiza antes de firmar.</span>
          <button onClick={onSync} disabled={syncing} type="button"
            style={{ ...btnOutlineSt, padding: '3px 8px', fontSize: 10, color: '#92400E', borderColor: '#FDE68A', whiteSpace: 'nowrap' }}>
            {syncing ? 'Actualizando…' : 'Actualizar'}
          </button>
        </div>
      )}

      {/* Medios principales */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Medios principales</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {MEDIOS_PPAL.map(med => (
            <div key={med.key}>
              <label style={{ ...labelSt, marginBottom: 3 }}>{med.label}</label>
              <MoneyInput disabled={esReadOnly} value={valores[med.key]} onChange={n => setValores(p => ({ ...p, [med.key]: n }))} />
              {esp && !syncing && (
                <Esperado valor={esperadoPorMedio[med.key]} declarado={valores[med.key]}
                  onUsar={cajaOperativa && !esReadOnly && med.key !== 'efectivo' ? (v => setValores(p => ({ ...p, [med.key]: v }))) : null} />
              )}
            </div>
          ))}
        </div>
        {esp && N(esp.tarjeta_pos) > 0 && (
          <div style={{ fontSize: 10, color: '#6B7280', marginTop: 4 }}>
            El ledger trae además {fmt(N(esp.tarjeta_pos))} por POS integrado (crédito + débito sin desglose): repártelo según los vouchers.
          </div>
        )}
      </div>

      {/* Abonos aplicados: informativo, fuera de la suma (base caja) */}
      {cajaOperativa && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
          <div>
            <div style={{ fontWeight: 600, color: '#92400E' }}>Abonos aplicados en tus ventas</div>
            <div style={{ fontSize: 10, color: '#92400E', opacity: 0.85 }}>Anticipos del cliente usados como pago. No es plata en tu caja: no lo declares.</div>
          </div>
          <div style={{ fontWeight: 700, color: '#92400E', whiteSpace: 'nowrap' }}>{fmt(abonoAplicadoLedger ?? 0)}</div>
        </div>
      )}

      {/* Otros medios */}
      <div>
        <button onClick={() => setOtrosOpen(v => !v)}
          style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontSize: 12, fontWeight: 600, color: '#374151' }}>
          Otros medios
          {otrosOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {otrosOpen && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            {MEDIOS_OTROS.map(med => (
              <div key={med.key}>
                <label style={{ ...labelSt, marginBottom: 3 }}>{med.label}</label>
                <MoneyInput disabled={esReadOnly} value={valores[med.key]} onChange={n => setValores(p => ({ ...p, [med.key]: n }))} />
                {esp && !syncing && esperadoPorMedio[med.key] != null && (
                  <Esperado valor={esperadoPorMedio[med.key]} declarado={valores[med.key]}
                    onUsar={cajaOperativa && !esReadOnly ? (v => setValores(p2 => ({ ...p2, [med.key]: v }))) : null} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Retiros del día (base caja) */}
      {rigeCaja && (
        <RetirosBlock retiros={todosRetiros} editable={!esReadOnly} onAgregar={agregarRetiro} onEliminar={quitarRetiro} />
      )}

      {/* Anticipos recibidos hoy: informativo (base caja) */}
      {esp && N(esp.abonos_recibidos) > 0 && (
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, color: '#1E40AF' }}>Anticipos de clientes recibidos hoy</span>
            <span style={{ fontWeight: 700, color: '#1E40AF' }}>{fmt(N(esp.abonos_recibidos))}</span>
          </div>
          <div style={{ fontSize: 10, color: '#1E40AF', opacity: 0.85, marginTop: 2 }}>
            Efectivo {fmt(N(esp.abonos_rec_efectivo))} · Tarjeta {fmt(N(esp.abonos_rec_tarjeta))} · Otros {fmt(N(esp.abonos_rec_otros))}.
            Esta plata está en tu caja y ya viene incluida en el esperado por medio. No es venta.
          </div>
        </div>
      )}

      {/* Total y brecha */}
      <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px', fontSize: 12 }}>
        {rigeCaja ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: '#6B7280' }}>Plata declarada por medio</span>
              <span>{fmt(plataDeclarada)}</span>
            </div>
            {totalRetiros > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ color: '#6B7280' }}>+ Retiros del día</span>
                <span>{fmt(totalRetiros)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #E5E7EB', paddingTop: 4, marginTop: 2, marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>Caja declarada</span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{fmt(cajaDeclarada)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: '#6B7280' }}>Caja esperada (ledger BSALE)</span>
              <span>{esp ? fmt(cajaEsperada) : '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6B7280' }}>Brecha de caja</span>
              <BrechaChip valor={brecha} umbrales={umbrales} />
            </div>
            {brecha != null && Math.abs(brecha) > umbrales.cuadra && !esReadOnly && (
              <div style={{ fontSize: 10, color: '#6B7280', marginTop: 6 }}>
                {brecha < 0
                  ? 'Falta plata respecto del ledger. Si trasladaste efectivo a caja fuerte o lo depositaste antes de cerrar, regístralo como retiro.'
                  : 'Sobra plata respecto del ledger. Revisa si algún pago quedó sin registrar en BSALE.'}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: '#6B7280' }}>Tu declaración</span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{fmt(totalMedios)}</span>
            </div>
            {ventaContable != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#6B7280' }}>Brecha vs BSALE</span>
                <BrechaChip valor={brecha} umbrales={umbrales} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Documentos BSALE — auditoría */}
      {vendedorBsale?.documentos?.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            Documentos BSALE ({vendedorBsale.documentos.length})
          </div>
          <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '8px 10px', maxHeight: 200, overflowY: 'auto' }}>
            {vendedorBsale.documentos.map((doc) => (
              <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: '0.5px solid #E5E7EB', fontSize: 11 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                  <span style={{
                    background: doc.es_nc ? '#FEE2E2' : doc.tipo?.includes('BOLETA') ? '#DBEAFE' : doc.tipo?.includes('TICKET') ? '#D1FAE5' : '#FEF3C7',
                    color: doc.es_nc ? '#DC2626' : doc.tipo?.includes('BOLETA') ? '#1D4ED8' : doc.tipo?.includes('TICKET') ? '#065F46' : '#92400E',
                    padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600, flexShrink: 0
                  }}>
                    {doc.es_nc ? 'NC' : doc.tipo?.includes('BOLETA') ? 'BOL' : doc.tipo?.includes('TICKET') ? 'TKT' : 'FAC'}
                  </span>
                  <span style={{ color: '#374151' }}>N° {doc.numero}</span>
                  {doc.es_cruzado && (
                    <span title={`Recaudó: ${doc.recaudador?.nombre} · Vendió: ${doc.vendedor?.nombre}`}
                      style={{
                        background: '#EDE9FE', color: '#5B21B6',
                        padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                        display: 'inline-flex', alignItems: 'center', gap: 3
                      }}>
                      ↔ {doc.recaudador?.id === vendedorBsale.bsale_user_id
                        ? `vendió ${doc.vendedor?.nombre?.split(' ')[0] ?? ''}`
                        : `recaudó ${doc.recaudador?.nombre?.split(' ')[0] ?? ''}`}
                    </span>
                  )}
                </div>
                <span style={{ fontWeight: 600, color: doc.es_nc ? '#DC2626' : '#111827', flexShrink: 0 }}>
                  {doc.total < 0 ? '-' : ''}{new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(Math.abs(doc.total))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Observaciones */}
      <div>
        <label style={labelSt}>Observaciones</label>
        <textarea disabled={esReadOnly} value={obs} onChange={ev => setObs(ev.target.value)}
          placeholder="Notas opcionales" rows={2}
          style={{ ...inputSt, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }} />
      </div>

      {!esReadOnly && (
        <>
          {brecha != null && Math.abs(brecha) > umbrales.tolerable && obs.trim() === '' && (
            <div style={{ fontSize: 11, color: '#DC2626', textAlign: 'center' }}>
              Diferencia de {fmt(brecha)}: explica el motivo en Observaciones para poder firmar.
            </div>
          )}
          <button onClick={guardar} disabled={saving || (syncing && rigeCaja)} style={{ ...btnSt(), opacity: (saving || (syncing && rigeCaja)) ? 0.6 : 1 }}>
            {(saving || (syncing && rigeCaja)) && <Loader2 size={13} />}
            {syncing && rigeCaja ? 'Actualizando pagos de BSALE…' : cierre ? 'Actualizar cierre' : 'Firmar cierre'}
          </button>
        </>
      )}
      {esReadOnly && (
        <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 12, color: '#6B7280' }}>
          {estadoBadge(cierre.estado)} — cierre ya procesado
        </div>
      )}
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────
export function CierreDelDiaTab({ usuario }) {
  const [capsLoaded, setCapsLoaded] = useState(false)

  // Precargar capabilities al montar
  useEffect(() => {
    if (usuario?.id) preloadCaps(usuario, 'finanzas').then(() => setCapsLoaded(true))
  }, [usuario?.id])

  // RBAC-4: determinar modo via capabilities dinámicas
  // ver_todas_sucursales: puede elegir cualquier sucursal y ve todos los cajeros
  // corroborar: puede corroborar cierres de otros
  // declarar: modo cajero — solo ve sus propios datos
  const esAdmin = capsLoaded
    ? canSync(usuario, 'finanzas', 'fin.teso.cierre.ver_todas') !== false
    : usuario?.rol === 'admin'

  const puedeCorroborar = capsLoaded
    ? canSync(usuario, 'finanzas', 'fin.teso.cierre.corroborar') !== false
    : usuario?.rol === 'admin'

  // Edición administrativa de cierres firmados/corroborados (capability exclusiva)
  const puedeEditar = capsLoaded
    ? canSync(usuario, 'finanzas', 'fin.teso.cierre.editar') !== false
    : usuario?.rol === 'admin'

  // sucursalFiltro: null = ve todas, 'suc-lg' = solo esa sucursal
  const sucursalFiltro = capsLoaded
    ? userScopeSync(usuario, 'finanzas', 'fin.teso.cierre.corroborar')
    : null

  const [sucursales, setSucursales] = useState([])
  // Si hay filtro de sucursal por rol, forzar ese valor (no puede elegir otra)
  const sucursalForzada = sucursalFiltro  // null = puede elegir cualquiera
  const [sucursalSel, setSucursalSel] = useState(
    sucursalForzada || (esAdmin ? 'suc-lg' : (usuario.sucursal_id ?? ''))
  )

  // Sincronizar sucursalSel con sucursalForzada cuando caps cargan
  useEffect(() => {
    if (sucursalForzada) setSucursalSel(sucursalForzada)
  }, [sucursalForzada])
  const [fecha, setFecha] = useState(todayISO())
  const [syncHaceMin, setSyncHaceMin] = useState(null)
  const [umbrales, setUmbrales] = useState(UMBRALES_DEFAULT)

  // Datos BSALE
  const [bsaleData, setBsaleData] = useState(null)
  const [loadingBsale, setLoadingBsale] = useState(false)

  // Cierres declarados del día
  const [cierres, setCierres] = useState([])
  const [loadingCierres, setLoadingCierres] = useState(false)

  // Panel lateral
  const [panelVendedor, setPanelVendedor] = useState(null) // { bsaleUser, cierre }
  const [usersSucursal, setUsersSucursal] = useState([]) // usuarios de la sucursal con bsale_vendedor_id
  const [savingCorrob, setSavingCorrob] = useState(false)
  const [valoresCorrob, setValoresCorrob] = useState(null)
  const [obsAdmin, setObsAdmin] = useState('')
  // Modo edición administrativa (fin.teso.cierre.editar)
  const [modoEdicion, setModoEdicion] = useState(false)
  const [valoresEdit, setValoresEdit] = useState(null)
  const [savingEdit, setSavingEdit] = useState(false)

  // F2 · base caja física: cut-off parametrizado, esperado por cajero desde el ledger de pagos
  const [cfgTeso, setCfgTeso] = useState({ cajaFisicaDesde: '2026-09-21', tolerancia: 1000 })
  const [esperados, setEsperados] = useState([])       // filas de v_cierre_esperado del día × sucursal
  const [loadingEsp, setLoadingEsp] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [retirosPanel, setRetirosPanel] = useState([]) // retiros del cierre abierto en el panel del tesorero
  const rigeCaja = fecha >= cfgTeso.cajaFisicaDesde

  // Cargar catálogos
  useEffect(() => {
    fetchSucursales().then(setSucursales).catch(() => {})
    fetchUmbrales().then(setUmbrales).catch(() => {})
    fetchConfigTesoreria().then(setCfgTeso).catch(() => {})
  }, [])

  // Frescura del sync de pagos (cuándo corrió, no cuándo vendió alguien)
  const leerFrescura = useCallback(async () => {
    try {
      const f = await fetchFrescuraLedger()
      const pay = f.find(x => x.recurso === 'payments')
      setSyncHaceMin(pay?.ultima_corrida ? (Date.now() - new Date(pay.ultima_corrida).getTime()) / 60000 : null)
    } catch { setSyncHaceMin(null) }
  }, [])

  // Esperado por cajero desde el ledger. Sincroniza antes de mostrar cuando:
  //   · es hoy (siempre hay pagos entrando),
  //   · se pide explícitamente, o
  //   · algún cajero tiene el ledger incompleto (autorreparación del día mirado).
  // El sync recibe cubrir_desde = fecha: puede reparar cualquier día, no solo hoy.
  const cargarEsperados = useCallback(async (forzarSync = false) => {
    if (!sucursalSel) return
    setLoadingEsp(true)
    try {
      const primera = await fetchCierresEsperadosDia(fecha, sucursalSel)
      setEsperados(primera)
      const hayIncompletos = primera.some(e => coberturaLedger(e)?.incompleto)
      if (forzarSync || fecha === todayISO() || hayIncompletos) {
        setSyncing(true)
        await syncPagosIncremental(30, fecha)
        setEsperados(await fetchCierresEsperadosDia(fecha, sucursalSel))
      }
    } catch (e) {
      console.warn('[cargarEsperados]', e?.message)
    } finally { setLoadingEsp(false); setSyncing(false); leerFrescura() }
  }, [fecha, sucursalSel, leerFrescura])

  // Cargar datos BSALE (cache-first; opción forzar=true salta cache)
  const cargarBsale = useCallback(async (forzar = false) => {
    if (!sucursalSel) return
    setLoadingBsale(true)
    setBsaleData(null)
    try {
      const data = await fetchBsaleDia(fecha, sucursalSel, forzar)
      setBsaleData(data)
    } catch (e) {
      toast.error('Error al cargar BSALE')
    } finally { setLoadingBsale(false) }
  }, [fecha, sucursalSel])

  // Cargar cierres declarados
  const cargarCierres = useCallback(async () => {
    if (!sucursalSel) return
    setLoadingCierres(true)
    try {
      let q = supabase.from('cierres_caja').select('*')
        .eq('fecha', fecha)
        .eq('sucursal_id', sucursalSel)
        .neq('estado', 'anulado')
      // RBAC-4: filtrar por sucursal si el rol tiene scope_filter='sucursal'
      if (sucursalFiltro) q = q.eq('sucursal_id', sucursalFiltro)
      if (!esAdmin && !puedeCorroborar) q = q.eq('vendedor_id', usuario.id)
      const { data, error } = await q
      if (error) throw error

      // Resolver nombres vendedores
      const vIds = [...new Set((data ?? []).map(r => r.vendedor_id).filter(Boolean))]
      let vendMap = {}
      if (vIds.length > 0) {
        const { data: vends } = await supabase.from('usuarios').select('id, nombre').in('id', vIds)
        for (const v of vends ?? []) vendMap[v.id] = v.nombre
      }
      setCierres((data ?? []).map(r => ({
        ...r,
        vendedor_nombre: r.vendedor_id ? (vendMap[r.vendedor_id] ?? null) : null
      })))
    } catch (e) {
      toast.error('Error al cargar cierres')
    } finally { setLoadingCierres(false) }
  }, [fecha, sucursalSel, esAdmin, usuario.id])

  // Cargar todos los usuarios activos para mapear nombre BSALE → usuario.id real
  // No filtramos por sucursal porque admins/directores pueden tener sucursal_id = null
  useEffect(() => {
    supabase.from('usuarios')
      .select('id, nombre, rol, sucursal_id, bsale_user_id')
      .eq('activo', true)
      .then(({ data }) => setUsersSucursal(data || []))
      .catch(() => setUsersSucursal([]))
  }, [])

  useEffect(() => {
    cargarBsale()
    cargarCierres()
    cargarEsperados()
  }, [fecha, sucursalSel])

  const esperadoMap = useMemo(() => {
    const m = new Map()
    for (const e of esperados) m.set(String(e.bsale_user_id), e)
    return m
  }, [esperados])

  // Cruzar RECAUDADORES BSALE con cierres declarados
  // Usamos por_recaudador (no por_vendedor) porque el cierre de caja se cuadra
  // con quien EMITIÓ la venta (tiene la plata), no con el seller asignado.
  const filas = useMemo(() => {
    const recaudadoresBsale = bsaleData?.por_recaudador ?? []
    // Normaliza nombres para match: uppercase + sin tildes + espacios colapsados.
    // Evita fila huérfana cuando BSALE devuelve "GONZÁLEZ" y usuarios tiene "Gonzalez".
    const norm = s => (s ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
    const result = []

    // Recaudadores con actividad BSALE hoy
    for (const bv of recaudadoresBsale) {
      const cierre = cierres.find(c => {
        return (c.bsale_vendedor_id != null && String(c.bsale_vendedor_id) === String(bv.bsale_user_id)) ||
          norm(c.vendedor_nombre) === norm(bv.nombre)
      })
      result.push({ bsaleUser: bv, cierre: cierre ?? null, esperado: esperadoMap.get(String(bv.bsale_user_id)) ?? null })
    }

    // Cajeros con plata en el ledger pero sin documentos de venta (p. ej. solo recibieron
    // un anticipo): tienen caja que declarar aunque no aparezcan en por_recaudador.
    for (const e of esperados) {
      const yaEsta = result.some(r => r.bsaleUser && String(r.bsaleUser.bsale_user_id) === String(e.bsale_user_id))
      if (yaEsta || (Number(e.n_pagos ?? 0) === 0 && Number(e.caja_esperada ?? 0) === 0)) continue
      const u = usersSucursal.find(x => x.bsale_user_id != null && String(x.bsale_user_id) === String(e.bsale_user_id))
      const cierre = cierres.find(c => c.bsale_vendedor_id != null && String(c.bsale_vendedor_id) === String(e.bsale_user_id))
      result.push({
        bsaleUser: {
          bsale_user_id: String(e.bsale_user_id), nombre: e.recaudador_nombre ?? u?.nombre ?? `Usuario ${e.bsale_user_id}`,
          venta: Number(e.venta_contable ?? 0), docs_venta: 0, docs_nc: 0, nc: 0, modalidades: {}, documentos: [], solo_caja: true,
        },
        cierre: cierre ?? null, esperado: e,
      })
    }

    // Cierres sin actividad BSALE (declaró pero no hay docs ni pagos en BSALE ese día)
    for (const c of cierres) {
      const yaEsta = result.some(r => r.cierre?.id === c.id)
      if (!yaEsta) result.push({ bsaleUser: null, cierre: c, esperado: c.bsale_vendedor_id != null ? (esperadoMap.get(String(c.bsale_vendedor_id)) ?? null) : null })
    }

    return result
  }, [bsaleData, cierres, esperados, esperadoMap, usersSucursal])

  // KPIs resumen
  const totalBsale = bsaleData?.total_venta ?? null
  const totalDeclarado = cierres.reduce((s, c) => s + Number(c.total_declarado ?? 0), 0)
  const brechaGlobal = totalBsale != null ? totalDeclarado - totalBsale : null
  const pendientes = cierres.filter(c => c.estado === 'declarado').length
  const corroborados = cierres.filter(c => ['cuadra', 'tolerable', 'descuadre'].includes(c.estado)).length
  // Base caja: esperado del día, caja declarada, brecha (solo cierres declarados) y plata aún sin declarar
  const cajaEsperadaDia = esperados.reduce((s, e) => s + Number(e.caja_esperada ?? 0), 0)
  const cajaDeclaradaDia = cierres.reduce((s, c) => s + Number(c.caja_declarada ?? 0), 0)
  const brechaCajaDia = filas.filter(f => f.cierre).reduce((s, f) => s + (Number(f.cierre.caja_declarada ?? 0) - Number(f.esperado?.caja_esperada ?? 0)), 0)
  const pendientePorDeclarar = filas.filter(f => !f.cierre).reduce((s, f) => s + Number(f.esperado?.caja_esperada ?? 0), 0)
  const incompletosDia = rigeCaja ? esperados.map(e => ({ e, c: coberturaLedger(e) })).filter(x => x.c?.incompleto) : []
  const ledgerAl = esperados.reduce((m, e) => (e.ultimo_pago_at && (!m || e.ultimo_pago_at > m)) ? e.ultimo_pago_at : m, null)

  // Puente con el cierre de caja de BSALE (explica las diferencias de cifras)
  const [puenteBsale, setPuenteBsale] = useState(null)
  useEffect(() => {
    setPuenteBsale(null)
    if (!fecha || !sucursalSel) return
    fetchPuenteBsale(fecha, sucursalSel).then(setPuenteBsale).catch(() => setPuenteBsale(null))
  }, [fecha, sucursalSel, esperados])
  const mediosLedger = useMemo(() => {
    const acc = {}
    const add = (k, v) => { const n = Number(v ?? 0); if (n) acc[k] = (acc[k] ?? 0) + n }
    for (const e of esperados) {
      add('EFECTIVO', e.efectivo); add('TARJETA CRÉDITO', e.t_credito); add('TARJETA DÉBITO', e.t_debito)
      add('POS INTEGRADO', e.tarjeta_pos); add('TRANSFERENCIA', e.transferencia); add('WEBPAY', e.webpay)
      add('MERCADO PAGO', e.m_pago); add('CHEQUE', e.cheque); add('PUNTOS CLAY', e.p_clay)
      add('− DEVOLUCIONES EN DINERO', -Number(e.devoluciones_dinero ?? 0))
    }
    return acc
  }, [esperados])

  // Panel lateral: corroborar
  function abrirPanel(fila) {
    setPanelVendedor(fila)
    setModoEdicion(false)
    setValoresEdit(null)
    setRetirosPanel([])
    if (fila.cierre) {
      const v = {}
      for (const med of MEDIOS) v[`${med.key}_corrob`] = Number(fila.cierre[`${med.key}_corrob`] ?? fila.cierre[med.key] ?? 0)
      setValoresCorrob(v)
      setObsAdmin(fila.cierre.observaciones_admin ?? '')
      fetchRetiros(fila.cierre.id).then(setRetirosPanel).catch(() => setRetirosPanel([]))
    } else {
      setValoresCorrob(null)
      setObsAdmin('')
    }
  }

  // Retiros desde el panel del tesorero (reconstrucción de traslados no registrados;
  // no toca montos declarados ni corroborados, solo la caja declarada comparable)
  async function refrescarCierrePanel(id) {
    const { data } = await supabase.from('cierres_caja').select('*').eq('id', id).maybeSingle()
    if (data) setPanelVendedor(prev => prev?.cierre?.id === id ? { ...prev, cierre: { ...prev.cierre, ...data } } : prev)
    await cargarCierres()
  }
  async function agregarRetiroPanel(r) {
    const c = panelVendedor?.cierre
    if (!c) return
    await crearRetiro({ cierre_id: c.id, fecha: c.fecha, sucursal_id: c.sucursal_id, ...r, nota: r.nota ? `${r.nota} · registrado por tesorería` : 'registrado por tesorería' })
    setRetirosPanel(await fetchRetiros(c.id))
    await refrescarCierrePanel(c.id)
  }
  async function quitarRetiroPanel(r) {
    const c = panelVendedor?.cierre
    if (!c || !r.id) return
    await eliminarRetiro(r.id)
    setRetirosPanel(await fetchRetiros(c.id))
    await refrescarCierrePanel(c.id)
  }

  function iniciarEdicion() {
    if (!panelVendedor?.cierre) return
    const v = {}
    for (const med of MEDIOS) {
      v[med.key] = Number(panelVendedor.cierre[med.key] ?? 0)
      v[`${med.key}_corrob`] = Number(panelVendedor.cierre[`${med.key}_corrob`] ?? 0)
    }
    setValoresEdit(v)
    setObsAdmin(panelVendedor.cierre.observaciones_admin ?? '')
    setModoEdicion(true)
  }

  async function handleGuardarEdicion() {
    if (!panelVendedor?.cierre || !valoresEdit) return
    setSavingEdit(true)
    try {
      const res = await editarCierreAdmin({
        id: panelVendedor.cierre.id,
        vendedor_nombre: panelVendedor.bsaleUser?.nombre ?? panelVendedor.cierre?.vendedor_nombre ?? null,
        observaciones_admin: obsAdmin.trim() || null,
        ...valoresEdit,
      })
      toast.success(`Cierre editado — estado: ${res.estado}`)
      if (res.descuadre_nota) toast.warning(res.descuadre_nota)
      setModoEdicion(false)
      setValoresEdit(null)
      await cargarCierres()
      setPanelVendedor(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al editar')
    } finally { setSavingEdit(false) }
  }

  async function handleCorrob() {
    if (!panelVendedor?.cierre || !valoresCorrob) return
    setSavingCorrob(true)
    try {
      const updated = await corroborarCierre({ id: panelVendedor.cierre.id, ...valoresCorrob, observaciones_admin: obsAdmin.trim() || null })
      toast.success(`Corroborado — estado: ${updated.estado}`)
      setCierres(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated, vendedor_nombre: c.vendedor_nombre } : c))
      setPanelVendedor(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error') }
    finally { setSavingCorrob(false) }
  }

  const totalCorrobPanel = useMemo(() => {
    if (!valoresCorrob) return 0
    return MEDIOS.reduce((s, m) => s + Number(valoresCorrob[`${m.key}_corrob`] ?? 0), 0)
  }, [valoresCorrob])

  const diferenciaPanel = panelVendedor?.cierre ? totalCorrobPanel - Number(panelVendedor.cierre.total_declarado ?? 0) : 0
  const obsRequerida = diferenciaPanel !== 0 && obsAdmin.trim() === ''

  // Esperado del cajero abierto en el panel, siempre desde el mapa vigente (se refresca al sincronizar)
  const esperadoPanel = panelVendedor
    ? (panelVendedor.bsaleUser
        ? (esperadoMap.get(String(panelVendedor.bsaleUser.bsale_user_id)) ?? panelVendedor.esperado ?? null)
        : (panelVendedor.cierre?.bsale_vendedor_id != null ? (esperadoMap.get(String(panelVendedor.cierre.bsale_vendedor_id)) ?? null) : (panelVendedor.esperado ?? null)))
    : null
  const cierrePanel = panelVendedor?.cierre ?? null
  const retirosPanelTotal = retirosPanel.reduce((s, r) => s + Number(r.monto ?? 0), 0)
  const plataDeclaradaPanel = cierrePanel
    ? MEDIOS.filter(m => !['abono_cliente', 'canje'].includes(m.key)).reduce((s, m) => s + Number(cierrePanel[m.key] ?? 0), 0)
    : 0
  const cajaDeclaradaPanel = plataDeclaradaPanel + retirosPanelTotal
  const cajaEsperadaPanelLive = esperadoPanel ? Number(esperadoPanel.caja_esperada ?? 0) : null
  const cajaEsperadaPanelSnap = cierrePanel?.caja_esperada_api != null ? Number(cierrePanel.caja_esperada_api) : null
  const brechaCajaPanel = cajaEsperadaPanelLive != null ? cajaDeclaradaPanel - cajaEsperadaPanelLive : null
  const movsPostCierre = cajaEsperadaPanelLive != null && cajaEsperadaPanelSnap != null ? cajaEsperadaPanelLive - cajaEsperadaPanelSnap : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Filtros ── */}
      <div style={cardSt}>
        <div style={{ display: 'grid', gridTemplateColumns: (esAdmin || puedeCorroborar) ? '1fr 1fr auto auto' : '1fr auto auto', gap: 12, alignItems: 'flex-end' }}>
          {(esAdmin || puedeCorroborar) && (
            <div>
              <label style={labelSt}>Sucursal</label>
              <select style={{...selectSt, opacity: sucursalForzada ? 0.6 : 1}} value={sucursalSel} onChange={e => !sucursalForzada && setSucursalSel(e.target.value)} disabled={!!sucursalForzada}>
                {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
              {sucursalForzada && <div style={{fontSize:11,color:'#8E8E93',marginTop:3}}>Restringido a tu sucursal</div>}
            </div>
          )}
          <div>
            <label style={labelSt}>Fecha</label>
            <input type="date" style={inputSt} value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button onClick={() => { cargarBsale(true); cargarCierres(); cargarEsperados(true) }}
              style={{ ...btnSt('#6B7280'), padding: '8px 14px' }}
              disabled={loadingBsale || loadingCierres || loadingEsp}
              title="Refrescar desde BSALE (ventas y ledger de pagos)">
              {(loadingBsale || loadingCierres || loadingEsp)
                ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                : <RefreshCw size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {(rigeCaja ? [
          { label: 'Venta contable', value: totalBsale, loading: loadingBsale, color: '#1e3a5f' },
          { label: 'Caja esperada', value: esperados.length ? cajaEsperadaDia : null, loading: loadingEsp && !esperados.length, color: '#166534',
            sub: ledgerAl ? `ledger ${fmtHora(ledgerAl)}${syncing ? ' · actualizando…' : ''}` : (syncing ? 'actualizando…' : null) },
          { label: 'Caja declarada', value: cajaDeclaradaDia || null, color: '#374151' },
          { label: 'Brecha de caja', value: cierres.length ? brechaCajaDia : null, isBrecha: true, sub: `${cierres.length} cierre${cierres.length !== 1 ? 's' : ''} declarado${cierres.length !== 1 ? 's' : ''}` },
          { label: 'Pendiente por declarar', value: pendientePorDeclarar || null, color: pendientePorDeclarar > 0 ? '#D97706' : '#16A34A' },
          { label: 'Pendientes', value: pendientes, isCuenta: true, color: pendientes > 0 ? '#D97706' : '#16A34A' },
          { label: 'Corroborados', value: corroborados, isCuenta: true, color: '#16A34A' },
        ] : [
          { label: 'Venta BSALE', value: totalBsale, loading: loadingBsale, color: '#1e3a5f' },
          { label: 'Total declarado', value: totalDeclarado || null, color: '#374151' },
          { label: 'Brecha global', value: brechaGlobal, isBrecha: true, color: '#374151' },
          { label: 'Pendientes', value: pendientes, isCuenta: true, color: pendientes > 0 ? '#D97706' : '#16A34A' },
          { label: 'Corroborados', value: corroborados, isCuenta: true, color: '#16A34A' },
        ]).map(kpi => (
          <div key={kpi.label} style={{ ...cardSt, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              {kpi.label}
            </div>
            {kpi.loading
              ? <Loader2 size={16} style={{ color: '#9CA3AF' }} />
              : kpi.isCuenta
                ? <div style={{ fontSize: 22, fontWeight: 700, color: kpi.color }}>{kpi.value ?? 0}</div>
                : kpi.isBrecha
                  ? <BrechaChip valor={kpi.value} umbrales={umbrales} />
                  : <div style={{ fontSize: 18, fontWeight: 700, color: kpi.color }}>{kpi.value != null ? fmt(kpi.value) : '—'}</div>
            }
            {kpi.sub && <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 3 }}>{kpi.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Desglose por medio: base caja = ledger de pagos; base venta = cache de documentos ── */}
      {rigeCaja && Object.keys(mediosLedger).length > 0 && (
        <div style={{ ...cardSt, padding: '12px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Caja física esperada por medio (ledger de pagos BSALE)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(mediosLedger)
              .sort(([, a], [, b]) => Number(b) - Number(a))
              .map(([medio, amt]) => (
                <div key={medio} style={{ background: '#F3F4F6', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
                  <span style={{ color: '#6B7280' }}>{medio}: </span>
                  <span style={{ fontWeight: 600, color: amt < 0 ? '#DC2626' : '#111827' }}>{fmt(Number(amt))}</span>
                </div>
              ))}
          </div>
        </div>
      )}
      {/* ── Puente con el cierre de caja de BSALE ── */}
      {rigeCaja && puenteBsale && (() => {
        const P = k => Number(puenteBsale[k] ?? 0)
        const enEspejo = P('caja_ventas_snapshot'), fuera = P('caja_fuera_snapshot')
        const abRec = P('abonos_recibidos'), abAplic = P('abono_aplicado') + P('nc_aplicada')
        const ncCred = P('nc_credito_generado'), devol = P('devoluciones_dinero')
        const cajaLedger = enEspejo + fuera + abRec - devol
        const F = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 12 }
        const L = ({ l, v, sub, neg, bold }) => (
          <div style={{ ...F, borderBottom: bold ? 'none' : '1px solid #F3F4F6' }}>
            <span style={{ color: bold ? '#111827' : '#374151', fontWeight: bold ? 700 : 500 }}>
              {l}{sub && <span style={{ display: 'block', fontSize: 10, color: '#9CA3AF', fontWeight: 400 }}>{sub}</span>}
            </span>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: bold ? 700 : 600, color: neg ? '#DC2626' : '#111827', whiteSpace: 'nowrap' }}>
              {neg ? '−' : ''}{fmt(Math.abs(v))}
            </span>
          </div>
        )
        return (
          <div style={{ ...cardSt, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Puente con el cierre de caja de BSALE
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
              <div>
                <L l="Ventas del día ya en el espejo de documentos" sub={`${puenteBsale.docs_snapshot} documento(s) sincronizados — es la Venta contable`} v={enEspejo} />
                {fuera > 0 && <L l="Pagos de documentos fuera del espejo" sub="boletas/facturas recién emitidas que llegan en la próxima corrida (cada 30 min), documentos de otros días cobrados hoy, o pagos de venta web (la venta se clasifica en Página Web) — por esto hay recaudadores 'sin documentos'" v={fuera} />}
                {abRec > 0 && <L l="Abonos recibidos sin documento" sub="el cliente adelantó plata: es caja, no es venta" v={abRec} />}
                {devol > 0 && <L l="Devoluciones en dinero" sub="salió plata del cajón" v={devol} neg />}
                <div style={{ marginTop: 4 }}><L l="Caja del día según ledger de pagos" v={cajaLedger} bold /></div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                  Lo que BSALE muestra distinto en su resumen
                </div>
                {abAplic > 0 && <L l="Pagado con Abono cliente / NC" sub="BSALE lo suma como medio de venta; aquí no entra plata (el cliente usó saldo)" v={abAplic} />}
                {ncCred > 0 && <L l="NC del día que generaron crédito" sub="BSALE las resta de la venta; no salió plata del cajón, quedó saldo a favor del cliente" v={ncCred} />}
                {abAplic === 0 && ncCred === 0 && (
                  <div style={{ fontSize: 11, color: '#9CA3AF', padding: '6px 0' }}>Sin abonos aplicados ni NC de crédito hoy: el teórico de BSALE debería calzar directo con la caja esperada.</div>
                )}
                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 8, lineHeight: 1.5, borderTop: '1px solid #F3F4F6', paddingTop: 6 }}>
                  La Venta contable sale del espejo de documentos; la Caja esperada sale del ledger de pagos, que siempre está más fresco.
                  El espejo del día en curso se actualiza cada 30 min (corrida intradía), así que las cifras convergen solas durante el día.
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {!rigeCaja && bsaleData?.medios_global && Object.keys(bsaleData.medios_global).length > 0 && (
        <div style={{ ...cardSt, padding: '12px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Desglose BSALE por medio de pago
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(bsaleData.medios_global)
              .sort(([, a], [, b]) => Number(b) - Number(a))
              .map(([medio, amt]) => (
                <div key={medio} style={{ background: '#F3F4F6', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>
                  <span style={{ color: '#6B7280' }}>{medio}: </span>
                  <span style={{ fontWeight: 600, color: '#111827' }}>{fmt(Number(amt))}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Aviso de cobertura: si faltan pagos en el ledger, los esperados de esos cajeros no son confiables */}
      {incompletosDia.length > 0 && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#991B1B', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>
            <strong>El ledger está incompleto para {incompletosDia.length} cajero{incompletosDia.length !== 1 ? 's' : ''}</strong>
            {' '}(faltan {fmt(incompletosDia.reduce((a, x) => a + x.c.faltante, 0))} en pagos que BSALE sí registró).
            {' '}Sus cajas esperadas están marcadas en rojo y no deben usarse para firmar hasta actualizar.
          </span>
          <button onClick={() => cargarEsperados(true)} disabled={syncing} type="button"
            style={{ ...btnOutlineSt, padding: '5px 11px', fontSize: 11, color: '#991B1B', borderColor: '#FECACA', whiteSpace: 'nowrap' }}>
            {syncing ? 'Actualizando…' : 'Actualizar ledger'}
          </button>
        </div>
      )}

      {/* ── Tabla de vendedores ── */}
      <div style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                {(rigeCaja
                  ? ['Recaudador', 'Venta contable', 'Caja esperada', 'Caja declarada', 'Brecha caja', 'Arqueo', '']
                  : ['Recaudador', 'Venta BSALE', 'Declarado', 'Brecha', 'Arqueo', '']
                ).map(h => (
                  <th key={h} style={{
                    padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#6B7280',
                    textAlign: ['Venta contable', 'Caja esperada', 'Caja declarada', 'Brecha caja', 'Venta BSALE', 'Declarado', 'Brecha'].includes(h) ? 'right' : 'left',
                    borderBottom: '1px solid #E5E7EB', whiteSpace: 'nowrap'
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(loadingBsale || loadingCierres) && (
                <tr><td colSpan={rigeCaja ? 7 : 6} style={{ textAlign: 'center', padding: '32px 0' }}>
                  <Loader2 size={20} style={{ display: 'inline-block', color: '#9CA3AF' }} />
                </td></tr>
              )}
              {!loadingBsale && !loadingCierres && filas.length === 0 && (
                <tr><td colSpan={rigeCaja ? 7 : 6} style={{ textAlign: 'center', padding: '32px 0', color: '#9CA3AF', fontSize: 13 }}>
                  Sin actividad para esta fecha y sucursal
                </td></tr>
              )}
              {!loadingBsale && !loadingCierres && filas.map((fila, i) => {
                const { bsaleUser, cierre, esperado } = fila
                const recaud = bsaleUser?.venta ?? null
                const cajaEsp = esperado ? Number(esperado.caja_esperada ?? 0) : null
                const cobFila = rigeCaja ? coberturaLedger(esperado) : null
                const declarado = cierre ? Number(rigeCaja ? (cierre.caja_declarada ?? 0) : (cierre.total_declarado ?? 0)) : null
                const brecha = declarado == null ? null
                  : rigeCaja ? (cajaEsp != null ? declarado - cajaEsp : null)
                  : (recaud != null ? declarado - recaud : null)
                const estado = cierre?.estado ?? null
                const nombre = bsaleUser?.nombre ?? cierre?.vendedor_nombre ?? '—'

                return (
                  <tr key={i}
                    style={{ borderTop: '1px solid #F3F4F6', cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#F9FAFB'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    onClick={() => abrirPanel(fila)}>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%', background: '#E0E7FF',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, color: '#4F46E5', flexShrink: 0
                        }}>
                          {nombre.split(' ').map(w => w[0]).join('').slice(0, 2)}
                        </div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{nombre}</div>
                          {bsaleUser && (
                            <div style={{ fontSize: 10, color: '#9CA3AF' }}>
                              {bsaleUser.solo_caja
                                ? `sin documentos · ${Number(esperado?.n_pagos ?? 0)} pago${Number(esperado?.n_pagos ?? 0) !== 1 ? 's' : ''}`
                                : <>{bsaleUser.docs_venta} doc{bsaleUser.docs_venta !== 1 ? 's' : ''}{bsaleUser.nc > 0 && ` · ${bsaleUser.docs_nc} NC`}</>}
                              {rigeCaja && esperado && Number(esperado.abonos_recibidos ?? 0) > 0 && ` · anticipos ${fmt(Number(esperado.abonos_recibidos))}`}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: rigeCaja ? 500 : 600, fontSize: rigeCaja ? 12 : 13, color: rigeCaja ? '#6B7280' : undefined }}>
                      {recaud != null ? fmt(recaud) : <span style={{ color: '#D1D5DB' }}>—</span>}
                    </td>
                    {rigeCaja && (
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, fontSize: 13, color: '#166534' }}>
                        {cajaEsp != null ? (
                          <span title={cobFila?.incompleto ? `Ledger incompleto: faltan ${fmt(cobFila.faltante)} en pagos sincronizados` : undefined}
                            style={cobFila?.incompleto ? { color: '#DC2626' } : undefined}>
                            {cobFila?.incompleto && <AlertTriangle size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: '-1px' }} />}
                            {fmt(cajaEsp)}
                          </span>
                        ) : (loadingEsp ? <Loader2 size={12} style={{ color: '#9CA3AF' }} /> : <span style={{ color: '#D1D5DB' }}>—</span>)}
                      </td>
                    )}
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13 }}>
                      {declarado != null ? fmt(declarado) : (
                        <span style={{ fontSize: 11, color: '#9CA3AF', background: '#FEF9C3', padding: '2px 6px', borderRadius: 4 }}>Pendiente</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                      <BrechaChip valor={brecha} umbrales={umbrales} />
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {estado
                        ? <ArqueoChip cierre={cierre} />
                        : <span style={{ fontSize: 11, color: '#9CA3AF' }}>Sin cierre</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontSize: 12, color: '#4F46E5', fontWeight: 500 }}>
                        {cierre?.estado === 'declarado' ? 'Corroborar →' : cierre ? 'Ver →' : (esAdmin || puedeCorroborar) ? 'Ver →' : 'Declarar →'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Panel lateral ── */}
      {panelVendedor && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 'calc(70px + env(safe-area-inset-bottom))', zIndex: 50, display: 'flex' }}>
          <div style={{ flex: 1, background: 'rgba(0,0,0,0.4)' }} onClick={() => setPanelVendedor(null)} />
          <aside style={{
            width: 520, maxWidth: '100%', height: '100%', background: '#fff',
            display: 'flex', flexDirection: 'column',
            boxShadow: '-4px 0 32px rgba(0,0,0,0.15)', overflow: 'hidden'
          }}>

            {/* Header panel */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>
                  {panelVendedor.bsaleUser?.nombre ?? panelVendedor.cierre?.vendedor_nombre ?? 'Vendedor'}
                </div>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{fecha}</div>
              </div>
              <button onClick={() => setPanelVendedor(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ flex: 1, padding: '16px 20px', overflowY: 'auto', minHeight: 0 }}>

              {/* Si no hay cierre → panel declaración (admin/corroborador en nombre del vendedor, cajero su propio cierre) */}
              {!panelVendedor.cierre && (
                <PanelDeclaracion
                  vendedorBsale={panelVendedor.bsaleUser}
                  cierre={panelVendedor.cierre}
                  sucursalId={sucursalSel}
                  fecha={fecha}
                  usuario={usuario}
                  vendedorReal={
                    panelVendedor.bsaleUser
                      ? (usersSucursal.find(u =>
                          u.bsale_user_id != null &&
                          String(u.bsale_user_id) === String(panelVendedor.bsaleUser.bsale_user_id)
                        ) ?? usersSucursal.find(u => {
                          const norm = s => (s ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
                          return norm(u.nombre) === norm(panelVendedor.bsaleUser.nombre)
                        }))
                      : null
                  }
                  umbrales={umbrales}
                  rigeCaja={rigeCaja}
                  esperado={esperadoPanel}
                  syncing={syncing}
                  onSync={() => cargarEsperados(true)}
                  esHoy={fecha === todayISO()}
                  syncHaceMin={syncHaceMin}
                  onGuardado={async () => {
                    // Recargar desde BD para resolver vendedor_nombre y garantizar
                    // que el match con BSALE funcione igual que tras un F5.
                    await cargarCierres()
                    setPanelVendedor(null)
                  }}
                />
              )}

              {/* Panel corroboración admin */}
              {(esAdmin || puedeCorroborar) && panelVendedor.cierre && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                  {/* BSALE del vendedor: base caja muestra venta contable y caja esperada; base venta, lo histórico */}
                  {rigeCaja && (panelVendedor.bsaleUser || esperadoPanel) && (
                    <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1a2f4a 100%)', borderRadius: 10, padding: '12px 14px', color: '#fff' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Venta contable</div>
                          <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(panelVendedor.bsaleUser?.venta ?? (esperadoPanel?.venta_contable != null ? Number(esperadoPanel.venta_contable) : null))}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 10, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Caja esperada (ledger)</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: '#86EFAC' }}>{cajaEsperadaPanelLive != null ? fmt(cajaEsperadaPanelLive) : '—'}</div>
                          {esperadoPanel && <div style={{ fontSize: 10, opacity: 0.6 }}>{Number(esperadoPanel.n_pagos ?? 0)} pagos · {fmtHora(esperadoPanel.ultimo_pago_at)}</div>}
                        </div>
                      </div>
                      {esperadoPanel && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                          {[['Efectivo', esperadoPanel.efectivo], ['Tarjetas', esperadoPanel.tarjetas_total], ['Transf.', esperadoPanel.transferencia], ['Webpay', esperadoPanel.webpay],
                            ['Anticipos rec.', esperadoPanel.abonos_recibidos], ['Abono aplicado', esperadoPanel.abono_aplicado], ['CxC', esperadoPanel.credito_cxc], ['Devol. dinero', esperadoPanel.devoluciones_dinero]]
                            .filter(([, v]) => Number(v ?? 0) !== 0)
                            .map(([l, v]) => (
                              <span key={l} style={{ fontSize: 10, background: 'rgba(255,255,255,0.15)', padding: '2px 6px', borderRadius: 4 }}>{l}: {fmt(Number(v))}</span>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                  {!rigeCaja && panelVendedor.bsaleUser && (
                    <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1a2f4a 100%)', borderRadius: 10, padding: '12px 14px', color: '#fff' }}>
                      <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Venta BSALE</div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(panelVendedor.bsaleUser.venta)}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {Object.entries(panelVendedor.bsaleUser.modalidades ?? {}).map(([medio, amt]) => (
                          <span key={medio} style={{ fontSize: 10, background: 'rgba(255,255,255,0.15)', padding: '2px 6px', borderRadius: 4 }}>
                            {medio.split(' ').slice(0, 2).join(' ')}: {fmt(Number(amt))}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Declaración del vendedor */}
                  {!modoEdicion && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Lo que declaró</div>
                    <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px' }}>
                      {MEDIOS.map(med => {
                        const esInformativo = rigeCaja && ['abono_cliente', 'canje'].includes(med.key)
                        const espMedio = rigeCaja && esperadoPanel && med.key !== 'abono_cliente' && med.key !== 'canje' ? Number(esperadoPanel[med.key] ?? 0) : null
                        return (
                          <div key={med.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12, opacity: esInformativo ? 0.6 : 1 }}>
                            <span style={{ color: '#6B7280' }}>{med.label}{esInformativo ? ' (no es caja)' : ''}</span>
                            <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                              <span>{fmt(Number(panelVendedor.cierre[med.key] ?? 0))}</span>
                              {espMedio != null && espMedio !== Number(panelVendedor.cierre[med.key] ?? 0) && (
                                <span style={{ fontSize: 10, color: '#9CA3AF' }} title="Esperado según ledger">esp. {fmt(espMedio)}</span>
                              )}
                            </span>
                          </div>
                        )
                      })}
                      {rigeCaja ? (
                        <>
                          {retirosPanelTotal > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                              <span style={{ color: '#6B7280' }}>+ Retiros del día</span>
                              <span>{fmt(retirosPanelTotal)}</span>
                            </div>
                          )}
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #E5E7EB', marginTop: 6, paddingTop: 6, fontWeight: 700, fontSize: 13 }}>
                            <span>Caja declarada</span>
                            <span>{fmt(cajaDeclaradaPanel)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, fontSize: 12 }}>
                            <span style={{ color: '#6B7280' }}>Caja esperada (ledger)</span>
                            <span>{cajaEsperadaPanelLive != null ? fmt(cajaEsperadaPanelLive) : '—'}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, fontSize: 12 }}>
                            <span style={{ color: '#6B7280' }}>Brecha de caja</span>
                            <BrechaChip valor={brechaCajaPanel} umbrales={umbrales} />
                          </div>
                          {movsPostCierre !== 0 && (
                            <div style={{ fontSize: 10, color: '#B45309', marginTop: 4 }}>
                              El ledger cambió {movsPostCierre > 0 ? '+' : ''}{fmt(movsPostCierre)} después de la declaración (pagos registrados en BSALE tras el cierre). Esperado al declarar: {fmt(cajaEsperadaPanelSnap)}.
                            </div>
                          )}
                          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, marginTop: 4, borderTop: '1px dashed #E5E7EB', fontSize: 10, color: '#9CA3AF' }}>
                            <span>Total declarado (base venta, incluye abono cliente)</span>
                            <span>{fmt(Number(panelVendedor.cierre.total_declarado ?? 0))}</span>
                          </div>
                        </>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #E5E7EB', marginTop: 6, paddingTop: 6, fontWeight: 700, fontSize: 13 }}>
                          <span>Total declarado</span>
                          <span>{fmt(Number(panelVendedor.cierre.total_declarado ?? 0))}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  )}

                  {/* Retiros del día — tesorería puede reconstruir traslados no registrados (traza en cierres_retiros) */}
                  {rigeCaja && !modoEdicion && (
                    <RetirosBlock retiros={retirosPanel} editable={puedeEditar} onAgregar={agregarRetiroPanel} onEliminar={quitarRetiroPanel}
                      titulo="Retiros de efectivo (caja fuerte / depósito)" />
                  )}

                  {/* Edición administrativa: montos declarados y corroborados */}
                  {modoEdicion && valoresEdit && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: '#92400E' }}>
                        Modo edición administrativa. El cambio queda trazado con tu usuario, fecha y detalle de montos.
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Montos declarados</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {MEDIOS.map(med => (
                            <div key={med.key} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', gap: 8 }}>
                              <label style={{ ...labelSt, marginBottom: 0, fontSize: 11 }}>{med.label}</label>
                              <MoneyInput value={valoresEdit[med.key]}
                                onChange={n => setValoresEdit(p => ({ ...p, [med.key]: n }))} />
                            </div>
                          ))}
                        </div>
                      </div>
                      {['cuadra', 'tolerable', 'descuadre'].includes(panelVendedor.cierre.estado) && (
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Montos corroborados</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {MEDIOS.map(med => (
                              <div key={`${med.key}_c`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', gap: 8 }}>
                                <label style={{ ...labelSt, marginBottom: 0, fontSize: 11 }}>{med.label}</label>
                                <MoneyInput value={valoresEdit[`${med.key}_corrob`]}
                                  onChange={n => setValoresEdit(p => ({ ...p, [`${med.key}_corrob`]: n }))} />
                              </div>
                            ))}
                          </div>
                          <div style={{ fontSize: 10, color: '#6B7280', marginTop: 6 }}>
                            Al guardar se reclasifica el estado, se reemplaza el descuadre pendiente y se recalcula la línea de depósito del día.
                          </div>
                        </div>
                      )}
                      <div>
                        <label style={labelSt}>Observaciones admin</label>
                        <textarea value={obsAdmin} onChange={e => setObsAdmin(e.target.value)} rows={2}
                          placeholder="Motivo de la edición (recomendado)"
                          style={{ ...inputSt, resize: 'vertical', fontFamily: 'inherit' }} />
                      </div>
                    </div>
                  )}

                  {/* Corroboración admin */}
                  {!modoEdicion && panelVendedor.cierre.estado === 'declarado' && valoresCorrob && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Corroborar</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {MEDIOS.map(med => (
                          <div key={med.key} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'center', gap: 8 }}>
                            <label style={{ ...labelSt, marginBottom: 0, fontSize: 11 }}>{med.label}</label>
                            <MoneyInput value={valoresCorrob[`${med.key}_corrob`]}
                              onChange={n => setValoresCorrob(p => ({ ...p, [`${med.key}_corrob`]: n }))} />
                          </div>
                        ))}
                      </div>
                      {/* Subtotal Getnet (Crédito + Débito) — referencia */}
                      <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 12px', marginTop: 8, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#065F46', fontWeight: 500 }}>💳 Total Getnet (Cred + Déb)</span>
                        <span style={{ fontWeight: 700, color: '#065F46' }}>
                          {fmt(Number(valoresCorrob.t_credito_corrob ?? 0) + Number(valoresCorrob.t_debito_corrob ?? 0))}
                        </span>
                      </div>

                      <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px', marginTop: 10, fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ color: '#6B7280' }}>Total corroborado</span>
                          <span style={{ fontWeight: 600 }}>{fmt(totalCorrobPanel)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#6B7280' }}>Diferencia</span>
                          <BrechaChip valor={diferenciaPanel} umbrales={umbrales} />
                        </div>
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <label style={labelSt}>Observaciones admin {diferenciaPanel !== 0 && <span style={{ color: '#DC2626' }}>*</span>}</label>
                        <textarea value={obsAdmin} onChange={e => setObsAdmin(e.target.value)} rows={2}
                          placeholder={diferenciaPanel !== 0 ? 'Obligatorio: explica la diferencia' : 'Opcional'}
                          style={{ ...inputSt, resize: 'vertical', fontFamily: 'inherit', borderColor: obsRequerida ? '#DC2626' : '#D1D5DB' }} />
                      </div>
                    </div>
                  )}

                  {!modoEdicion && panelVendedor.cierre.estado !== 'declarado' && (
                    <>
                      {/* Lo que se corroboró */}
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Lo que se corroboró</div>
                        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '10px 12px' }}>
                          {MEDIOS.map(med => {
                            const decl = Number(panelVendedor.cierre[med.key] ?? 0)
                            const corr = Number(panelVendedor.cierre[`${med.key}_corrob`] ?? 0)
                            const dif = corr - decl
                            return (
                              <div key={med.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12 }}>
                                <span style={{ color: '#1E40AF' }}>{med.label}</span>
                                <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                                  <span style={{ fontWeight: 600 }}>{fmt(corr)}</span>
                                  {dif !== 0 && (
                                    <span style={{ fontSize: 10, color: dif > 0 ? '#16A34A' : '#DC2626', fontFamily: 'monospace' }}>
                                      ({dif > 0 ? '+' : ''}{fmt(dif)})
                                    </span>
                                  )}
                                </span>
                              </div>
                            )
                          })}
                          {/* Subtotal Getnet */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', marginTop: 4, fontSize: 11, color: '#065F46', borderTop: '1px dashed #BFDBFE', paddingTop: 6 }}>
                            <span>💳 Total Getnet (Cred + Déb)</span>
                            <span style={{ fontWeight: 600 }}>
                              {fmt(Number(panelVendedor.cierre.t_credito_corrob ?? 0) + Number(panelVendedor.cierre.t_debito_corrob ?? 0))}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #BFDBFE', marginTop: 6, paddingTop: 6, fontWeight: 700, fontSize: 13 }}>
                            <span>Total corroborado</span>
                            <span>{fmt(Number(panelVendedor.cierre.total_corroborado ?? 0))}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, fontSize: 12 }}>
                            <span style={{ color: '#6B7280' }}>Diferencia</span>
                            <BrechaChip valor={Number(panelVendedor.cierre.diferencia ?? 0)} umbrales={umbrales} />
                          </div>
                          {panelVendedor.cierre.observaciones_admin && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #BFDBFE', fontSize: 11 }}>
                              <div style={{ color: '#6B7280', marginBottom: 2 }}>Observación admin:</div>
                              <div style={{ color: '#374151', fontStyle: 'italic' }}>{panelVendedor.cierre.observaciones_admin}</div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ textAlign: 'center', padding: 8 }}>
                        {estadoBadge(panelVendedor.cierre.estado)}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Footer panel */}
            <div style={{ padding: '12px 20px calc(12px + env(safe-area-inset-bottom)) 20px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0, background: '#fff' }}>
              <button onClick={() => setPanelVendedor(null)} style={btnOutlineSt}>Cerrar</button>
              {puedeEditar && panelVendedor.cierre && !modoEdicion && (
                <button onClick={iniciarEdicion} style={{ ...btnOutlineSt, color: '#B45309', borderColor: '#FCD34D' }}>
                  Editar cierre
                </button>
              )}
              {modoEdicion && (
                <button onClick={handleGuardarEdicion} disabled={savingEdit}
                  style={{ ...btnSt('#B45309'), opacity: savingEdit ? 0.6 : 1 }}>
                  {savingEdit && <Loader2 size={13} />}
                  Guardar edición
                </button>
              )}
              {!modoEdicion && (esAdmin || puedeCorroborar) && panelVendedor.cierre?.estado === 'declarado' && valoresCorrob && (
                <button onClick={handleCorrob} disabled={savingCorrob || obsRequerida}
                  style={{ ...btnSt(), opacity: savingCorrob || obsRequerida ? 0.6 : 1 }}>
                  {savingCorrob && <Loader2 size={13} />}
                  Confirmar corroboración
                </button>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
