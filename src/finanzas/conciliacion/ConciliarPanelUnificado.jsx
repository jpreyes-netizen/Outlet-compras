import { useEffect, useState, useMemo } from 'react'
import { toast } from 'sonner'
import { Search, Loader2, Check, Sparkles, Link2, AlertCircle, FileText, Package, X, Trash2 } from 'lucide-react'
import { supabase } from '../../supabase'
import {
  fetchFacturasCandidatas, fetchVinculados, vincularRespaldo, desvincular,
  extraerRut, buscarAprendizaje,
} from './api_conciliar'

const fmtCLP = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n ?? 0)
const fmtFecha = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y.slice(2)}` }

// Extrae el RUT del formato del banco Santander: "077288186K Transf a..." → "77288186-K"
// (el banco pega un cero adelante y omite el guión; el extraerRut estándar no lo capta)
function rutDesdeDescripcionBanco(desc) {
  if (!desc) return null
  const m = desc.match(/^0*(\d{7,8})([0-9kK])\s/)
  if (!m) return null
  return `${m[1]}-${m[2].toUpperCase()}`
}

// Extrae el nombre del proveedor: "077288186K Transf a Transportes sen spa" → "Transportes sen spa"
// Sirve para buscar por razón social cuando el RUT no calza.
function nombreDesdeDescripcionBanco(desc) {
  if (!desc) return ''
  return desc
    .replace(/^0*\d{7,8}[0-9kK]\s*/i, '')        // quita el RUT del inicio
    .replace(/\b(transf(erencia)?|pago|a|de|por|abono|cargo)\b/gi, ' ') // palabras de relleno
    .replace(/\s+/g, ' ')
    .trim()
}

// ════════════════════════════════════════════════════════════════════════
// PANEL DE CONCILIACIÓN UNIFICADO (estilo Chipax)
// Reemplaza RespaldosPanel + el modal del agente.
// - El monto se calcula automáticamente: MIN(saldo del cargo, saldo factura)
// - Selección múltiple de facturas con reparto FIFO. Imposible sobre-conciliar.
// - Si el agente tiene sugerencia para el movimiento, aparece destacada arriba.
// ════════════════════════════════════════════════════════════════════════
export function ConciliarPanelUnificado({ movimiento, onAfterChange, multiCargos = null, onMultiDone }) {
  // Modo pago múltiple: varios cargos seleccionados → una factura
  if (multiCargos && multiCargos.length > 0) {
    return <PanelMultiCargo cargos={multiCargos} onDone={onMultiDone} />
  }
  if (!movimiento) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', padding: 40, textAlign: 'center', border: '1px solid #E2E8F0', borderRadius: 14, background: '#fff' }}>
        <Link2 size={28} style={{ marginBottom: 12, opacity: 0.4 }} />
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: '#64748B' }}>Selecciona un movimiento</div>
        <div style={{ fontSize: 12 }}>Elige un cargo del banco a la izquierda para conciliarlo con sus facturas</div>
      </div>
    )
  }
  return <PanelActivo key={movimiento.movimiento_id} movimiento={movimiento} onAfterChange={onAfterChange} />
}

function PanelActivo({ movimiento, onAfterChange }) {
  const [tab, setTab] = useState('facturas')           // facturas | importaciones | otros
  const [vinculados, setVinculados] = useState([])
  const [loadingVinc, setLoadingVinc] = useState(true)

  // Facturas
  const [texto, setTexto] = useState('')
  const [candidatas, setCandidatas] = useState([])
  const [loadingCand, setLoadingCand] = useState(true)
  const [selOrden, setSelOrden] = useState([])         // ids en orden FIFO de selección
  const [observaciones, setObservaciones] = useState('')
  const [confirmando, setConfirmando] = useState(false)

  // Sugerencia del agente
  const [sugerencia, setSugerencia] = useState(null)
  const [aprendizaje, setAprendizaje] = useState(null)

  const cargoAbs = Math.abs(Number(movimiento.monto) || 0)
  const yaAplicado = Number(movimiento.total_aplicado) || 0
  const saldoCargo = Math.max(0, cargoAbs - yaAplicado)   // lo que falta por conciliar del cargo

  // Cargar respaldos ya vinculados
  function cargarVinculados() {
    setLoadingVinc(true)
    fetchVinculados(movimiento.movimiento_id)
      .then(setVinculados)
      .catch(e => toast.error(e.message))
      .finally(() => setLoadingVinc(false))
  }

  // Cargar facturas candidatas. Estrategia:
  //  1) Si hay texto de búsqueda manual, usarlo.
  //  2) Si no, extraer RUT del formato banco y buscar por RUT.
  //  3) Si el RUT no trae resultados, buscar por nombre del proveedor.
  function cargarCandidatas(q) {
    setLoadingCand(true)
    const rutBanco = rutDesdeDescripcionBanco(movimiento.descripcion)
    const rutStd = extraerRut(movimiento.descripcion)
    const rutHint = rutBanco || rutStd
    const objetivo = saldoCargo || cargoAbs

    const buscar = async () => {
      // Búsqueda manual explícita
      if (q && q.trim()) {
        return await fetchFacturasCandidatas({ texto: q.trim(), saldoObjetivo: objetivo, movimiento })
      }
      // Por RUT del banco
      let rows = await fetchFacturasCandidatas({ saldoObjetivo: objetivo, rutHint, movimiento })
      // Fallback: por nombre del proveedor
      if ((!rows || rows.length === 0)) {
        const nombre = nombreDesdeDescripcionBanco(movimiento.descripcion)
        if (nombre && nombre.length >= 3) {
          rows = await fetchFacturasCandidatas({ texto: nombre, saldoObjetivo: objetivo, movimiento })
        }
      }
      return rows
    }

    buscar()
      .then(rows => setCandidatas((rows ?? []).filter(f => f.estado_factura !== 'pagada' && Number(f.saldo) > 0)))
      .catch(e => toast.error(e.message))
      .finally(() => setLoadingCand(false))
  }

  // Cargar sugerencia del agente (si existe para este movimiento)
  function cargarSugerencia() {
    supabase.from('ai_match_sugerencias')
      .select('*')
      .eq('movimiento_id', movimiento.movimiento_id)
      .eq('estado', 'pendiente')
      .then(({ data }) => setSugerencia(data && data.length ? data : null))
  }

  useEffect(() => {
    cargarVinculados()
    cargarCandidatas('')
    cargarSugerencia()
    buscarAprendizaje(movimiento).then(setAprendizaje).catch(() => {})
    setSelOrden([]); setObservaciones(''); setTexto('')
  }, [movimiento.movimiento_id])

  // Reparto FIFO del saldo del cargo entre las facturas seleccionadas
  const plan = useMemo(() => {
    let restante = saldoCargo
    const filas = []
    for (const id of selOrden) {
      const f = candidatas.find(x => x.id === id)
      if (!f) continue
      const aplicar = Math.max(0, Math.min(restante, Number(f.saldo)))
      filas.push({ ...f, aplicar, quedaSaldo: Number(f.saldo) - aplicar })
      restante -= aplicar
    }
    return { filas, sobrante: restante, totalAplicar: saldoCargo - restante }
  }, [selOrden, candidatas, saldoCargo])

  function toggleFac(id) {
    setSelOrden(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function conciliar() {
    const aAplicar = plan.filas.filter(f => f.aplicar > 0)
    if (aAplicar.length === 0) return
    setConfirmando(true)
    const tid = toast.loading(`Conciliando ${aAplicar.length} factura(s)…`)
    try {
      for (const f of aAplicar) {
        await vincularRespaldo({
          movimientoId: movimiento.movimiento_id,
          tipoRespaldo: 'factura_compra',
          facturaId: f.id,
          monto: f.aplicar,
          observaciones,
          movimiento,
          proveedorNombre: f.razon_social ?? null,
        })
      }
      toast.success(`Conciliado ${fmtCLP(plan.totalAplicar)}`, { id: tid })
      setSelOrden([]); setObservaciones('')
      cargarVinculados(); cargarCandidatas(texto); cargarSugerencia()
      onAfterChange?.()
    } catch (e) {
      toast.error('Error: ' + e.message, { id: tid })
    } finally { setConfirmando(false) }
  }

  // Aceptar sugerencia del agente (1 clic). Marca las facturas sugeridas.
  async function aceptarSugerencia() {
    if (!sugerencia) return
    setConfirmando(true)
    const tid = toast.loading('Aplicando sugerencia del agente…')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      for (const s of sugerencia) {
        await supabase.rpc('fn_agente_aprobar_sugerencia', { p_sugerencia_id: s.id, p_user_id: user?.id ?? null })
      }
      toast.success('Sugerencia aplicada', { id: tid })
      cargarVinculados(); cargarCandidatas(texto); cargarSugerencia()
      onAfterChange?.()
    } catch (e) {
      toast.error('Error: ' + e.message, { id: tid })
    } finally { setConfirmando(false) }
  }

  async function handleDesvincular(id) {
    if (!confirm('¿Desvincular este respaldo?')) return
    try {
      await desvincular(id, movimiento.movimiento_id)
      toast.success('Desvinculado')
      cargarVinculados(); cargarCandidatas(texto)
      onAfterChange?.()
    } catch (e) { toast.error('Error: ' + e.message) }
  }

  const totalVinc = vinculados.reduce((a, v) => a + (Number(v.monto_aplicado) || 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', border: '1px solid #E2E8F0', borderRadius: 14, background: '#fff', overflow: 'hidden' }}>

      {/* ─── Cargo seleccionado + barra de uso ─── */}
      <div style={{ padding: '14px 16px', background: movimiento.tipo === 'CARGO' ? '#FEF2F2' : '#F0FDF4', borderBottom: `1px solid ${movimiento.tipo === 'CARGO' ? '#FECACA' : '#BBF7D0'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: movimiento.tipo === 'CARGO' ? '#991B1B' : '#166534' }}>
            {movimiento.tipo} · {fmtFecha(movimiento.fecha)}
          </span>
          <span style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: movimiento.tipo === 'CARGO' ? '#B91C1C' : '#15803D' }}>{fmtCLP(movimiento.monto)}</span>
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{movimiento.descripcion}</div>
        {/* Barra de uso del cargo */}
        <div style={{ height: 7, background: movimiento.tipo === 'CARGO' ? '#FECACA' : '#BBF7D0', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${cargoAbs ? Math.min(100, ((yaAplicado + plan.totalAplicar) / cargoAbs) * 100) : 0}%`, background: (saldoCargo - plan.totalAplicar) <= 0.5 ? '#16A34A' : '#F59E0B', borderRadius: 99, transition: 'width 0.3s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10 }}>
          <span style={{ color: '#64748B' }}>Ya conciliado: <b style={{ color: '#334155' }}>{fmtCLP(yaAplicado)}</b></span>
          <span style={{ color: '#64748B' }}>Por conciliar: <b style={{ color: '#334155' }}>{fmtCLP(saldoCargo - plan.totalAplicar)}</b></span>
        </div>
      </div>

      {/* ─── Sugerencia del agente (si existe) ─── */}
      {sugerencia && (
        <div style={{ margin: 12, padding: '10px 12px', background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sparkles size={16} color="#7C3AED" />
          <div style={{ flex: 1, fontSize: 11 }}>
            <div style={{ fontWeight: 700, color: '#5B21B6' }}>El agente sugiere {sugerencia.length === 1 ? 'esta factura' : `${sugerencia.length} facturas`}</div>
            <div style={{ color: '#7C3AED' }}>
              {sugerencia.map(s => `folio ${s.folio_factura} (${fmtCLP(s.monto_aplicar)})`).join(' · ')}
            </div>
          </div>
          <button onClick={aceptarSugerencia} disabled={confirmando}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: 'none', background: 'linear-gradient(to bottom, #8B5CF6, #7C3AED)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: confirmando ? 0.5 : 1 }}>
            {confirmando ? <Loader2 size={12} /> : <Check size={12} />} Aceptar
          </button>
        </div>
      )}

      {/* ─── Respaldos ya vinculados ─── */}
      {!loadingVinc && vinculados.length > 0 && (
        <div style={{ margin: '0 12px 8px', padding: '8px 10px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#166534', textTransform: 'uppercase', marginBottom: 4 }}>Ya vinculado · {fmtCLP(totalVinc)}</div>
          {vinculados.map(v => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '3px 0' }}>
              <Check size={11} color="#16A34A" />
              <span style={{ flex: 1, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {v.tipo_respaldo === 'factura_compra' ? `Folio ${v.folio ?? '—'} · ${v.proveedor ?? ''}` :
                 v.tipo_respaldo === 'importacion' ? `Importación ${v.folio ?? ''} · ${v.proveedor ?? ''}` : (v.observaciones ?? 'Otro')}
              </span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#15803D' }}>{fmtCLP(v.monto_aplicado)}</span>
              <button onClick={() => handleDesvincular(v.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', padding: 2, display: 'flex' }}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {/* ─── Tabs tipo de respaldo ─── */}
      <div style={{ display: 'flex', gap: 2, padding: '0 12px', borderBottom: '1px solid #E2E8F0' }}>
        {[
          { k: 'facturas', l: 'Facturas de compra', icon: FileText },
          { k: 'importaciones', l: 'Importaciones', icon: Package },
          { k: 'otros', l: 'Otros', icon: Link2 },
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 12px', fontSize: 12, fontWeight: 600,
            background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t.k ? '#1F4E79' : '#8E8E93',
            borderBottom: tab === t.k ? '2px solid #1F4E79' : '2px solid transparent',
          }}><t.icon size={13} /> {t.l}</button>
        ))}
      </div>

      {/* ─── Contenido por tab ─── */}
      {tab === 'facturas' && (
        <>
          {/* Buscador */}
          <div style={{ padding: '10px 12px', display: 'flex', gap: 8 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
              <input value={texto} onChange={e => setTexto(e.target.value)} onKeyDown={e => e.key === 'Enter' && cargarCandidatas(texto)}
                placeholder="Buscar RUT, razón social o folio"
                style={{ width: '100%', padding: '7px 10px 7px 26px', fontSize: 12, borderRadius: 7, border: '1px solid #E2E8F0', boxSizing: 'border-box' }} />
            </div>
            <button onClick={() => cargarCandidatas(texto)} style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #E2E8F0', background: '#fff', fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer' }}>Buscar</button>
          </div>

          {/* Lista candidatas */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }}>
            {loadingCand && <div style={{ padding: 30, textAlign: 'center', color: '#94A3B8' }}><Loader2 size={16} /></div>}
            {!loadingCand && candidatas.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>Sin facturas candidatas. Busca por proveedor o folio.</div>}
            {!loadingCand && candidatas.map(f => {
              const idx = selOrden.indexOf(f.id)
              const sel = idx >= 0
              const planF = plan.filas.find(p => p.id === f.id)
              const sc = f.match_score ?? 0
              const scoreColor = sc >= 90 ? { bg: '#DCFCE7', c: '#15803D' } : sc >= 60 ? { bg: '#FEF3C7', c: '#92400E' } : { bg: '#F1F5F9', c: '#64748B' }
              return (
                <div key={f.id} onClick={() => toggleFac(f.id)} style={{
                  padding: '9px 10px', marginBottom: 5, cursor: 'pointer',
                  background: sel ? '#EFF6FF' : '#fff',
                  border: sel ? '1px solid #3B82F6' : '1px solid #E2E8F0',
                  borderRadius: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {sel
                      ? <span style={{ width: 18, height: 18, borderRadius: 4, background: '#3B82F6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{idx + 1}</span>
                      : <span style={{ width: 18, height: 18, borderRadius: 4, border: '2px solid #CBD5E1', flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Folio {f.folio} · {f.razon_social}</div>
                      <div style={{ fontSize: 10, color: '#94A3B8' }}>{fmtFecha(f.fecha_emision)} · {f.estado_factura}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: '#334155' }}>{fmtCLP(f.saldo)}</div>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: scoreColor.bg, color: scoreColor.c }}>match {sc}%</span>
                    </div>
                  </div>
                  {/* Preview de aplicación */}
                  {sel && planF && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #BFDBFE', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                      <span style={{ color: '#1D4ED8', whiteSpace: 'nowrap' }}>Aplica <b style={{ fontFamily: 'monospace' }}>{fmtCLP(planF.aplicar)}</b></span>
                      <div style={{ flex: 1, height: 5, background: '#DBEAFE', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${f.saldo ? Math.min(100, (planF.aplicar / f.saldo) * 100) : 0}%`, background: planF.quedaSaldo <= 0 ? '#16A34A' : '#3B82F6' }} />
                      </div>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, whiteSpace: 'nowrap', background: planF.quedaSaldo <= 0 ? '#DCFCE7' : '#DBEAFE', color: planF.quedaSaldo <= 0 ? '#15803D' : '#1D4ED8' }}>
                        {planF.aplicar <= 0 ? 'cargo agotado' : planF.quedaSaldo <= 0 ? 'quedará pagada' : `parcial · queda ${fmtCLP(planF.quedaSaldo)}`}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Footer conciliar */}
          <div style={{ padding: '12px', borderTop: '1px solid #E2E8F0', background: '#F8FAFC' }}>
            {plan.totalAplicar > 0 && plan.filas.some(f => f.quedaSaldo > 0.5) && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, padding: '6px 9px', background: '#EFF6FF', borderRadius: 6, fontSize: 10, color: '#1D4ED8', marginBottom: 8 }}>
                <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Esta factura quedará <b>parcial</b>. Si se paga con varias transferencias, concilia este pago ahora y aplica los otros cargos a la misma factura después — el saldo se irá descontando hasta completarla.</span>
              </div>
            )}
            {plan.sobrante > 0.5 && plan.totalAplicar > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px', background: '#FEF3C7', borderRadius: 6, fontSize: 10, color: '#92400E', fontWeight: 600, marginBottom: 8 }}>
                <AlertCircle size={12} /> Sobran {fmtCLP(plan.sobrante)} del cargo sin aplicar (selecciona más facturas o queda parcial)
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={observaciones} onChange={e => setObservaciones(e.target.value)} placeholder="Observación (opcional)"
                style={{ flex: 1, padding: '8px 10px', fontSize: 11, borderRadius: 7, border: '1px solid #E2E8F0' }} />
              <button onClick={conciliar} disabled={plan.totalAplicar <= 0 || confirmando}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 7, border: 'none', background: 'linear-gradient(to bottom, #16A34A, #15803D)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: plan.totalAplicar <= 0 || confirmando ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                {confirmando ? <Loader2 size={13} /> : <Check size={13} />} Conciliar {fmtCLP(plan.totalAplicar)}
              </button>
            </div>
          </div>
        </>
      )}

      {tab === 'importaciones' && (
        <div style={{ flex: 1, padding: 20, textAlign: 'center', color: '#94A3B8', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          La conciliación de importaciones mantiene el flujo anterior. (Pendiente de unificar en próxima iteración.)
        </div>
      )}

      {tab === 'otros' && (
        <OtrosInline movimiento={movimiento} saldoCargo={saldoCargo} onAfterChange={() => { cargarVinculados(); onAfterChange?.() }} />
      )}
    </div>
  )
}

// ─── Tab "Otros" inline (sin modal) ──────────────────────────────────────
function OtrosInline({ movimiento, saldoCargo, onAfterChange }) {
  const [subtipo, setSubtipo] = useState('comision_bancaria')
  const [obs, setObs] = useState('')
  const [saving, setSaving] = useState(false)

  const SUBTIPOS = [
    { k: 'comision_bancaria', l: 'Comisión bancaria' },
    { k: 'impuesto', l: 'Impuesto / SII' },
    { k: 'transferencia_interna', l: 'Transferencia interna' },
    { k: 'ajuste', l: 'Ajuste' },
    { k: 'otro', l: 'Otro' },
  ]

  async function guardar() {
    setSaving(true)
    const tid = toast.loading('Guardando…')
    try {
      await vincularRespaldo({
        movimientoId: movimiento.movimiento_id,
        tipoRespaldo: 'otro',
        monto: saldoCargo,
        observaciones: obs,
        subtipoOtro: subtipo,
      })
      toast.success('Vinculado como otro', { id: tid })
      setObs('')
      onAfterChange?.()
    } catch (e) {
      toast.error('Error: ' + e.message, { id: tid })
    } finally { setSaving(false) }
  }

  return (
    <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
      <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
        Para gastos sin factura (comisiones, impuestos, transferencias internas). Se concilia el saldo completo del cargo: <b>{fmtCLP(saldoCargo)}</b>
      </div>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Tipo</label>
      <select value={subtipo} onChange={e => setSubtipo(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 7, border: '1px solid #E2E8F0', marginBottom: 12 }}>
        {SUBTIPOS.map(s => <option key={s.k} value={s.k}>{s.l}</option>)}
      </select>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 4 }}>Observación</label>
      <input value={obs} onChange={e => setObs(e.target.value)} placeholder="Detalle (opcional)"
        style={{ width: '100%', padding: '8px 10px', fontSize: 12, borderRadius: 7, border: '1px solid #E2E8F0', boxSizing: 'border-box', marginBottom: 12 }} />
      <button onClick={guardar} disabled={saving}
        style={{ width: '100%', padding: '10px', borderRadius: 7, border: 'none', background: '#1F4E79', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>
        {saving ? 'Guardando…' : `Conciliar como "otro" · ${fmtCLP(saldoCargo)}`}
      </button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════
// MODO PAGO MÚLTIPLE: varios cargos del banco → una sola factura
// Suma los cargos seleccionados y los aplica FIFO a la factura elegida.
// Si la suma supera el saldo de la factura, aplica hasta completarla y deja
// el resto del último cargo sin aplicar (avisando).
// ════════════════════════════════════════════════════════════════════════
function PanelMultiCargo({ cargos, onDone }) {
  const [texto, setTexto] = useState('')
  const [candidatas, setCandidatas] = useState([])
  const [loading, setLoading] = useState(true)
  const [facturaSel, setFacturaSel] = useState(null)
  const [observaciones, setObservaciones] = useState('')
  const [confirmando, setConfirmando] = useState(false)

  const sumaCargos = cargos.reduce((a, c) => a + Math.abs(Number(c.monto) || 0), 0)

  function cargarCandidatas(q) {
    setLoading(true)
    // Usar el RUT/nombre del primer cargo como pista
    const rutBanco = rutDesdeDescripcionBanco(cargos[0]?.descripcion)
    const nombre = nombreDesdeDescripcionBanco(cargos[0]?.descripcion)
    const buscar = async () => {
      if (q && q.trim()) return await fetchFacturasCandidatas({ texto: q.trim(), saldoObjetivo: sumaCargos, movimiento: cargos[0] })
      let rows = await fetchFacturasCandidatas({ saldoObjetivo: sumaCargos, rutHint: rutBanco, movimiento: cargos[0] })
      if ((!rows || rows.length === 0) && nombre && nombre.length >= 3) {
        rows = await fetchFacturasCandidatas({ texto: nombre, saldoObjetivo: sumaCargos, movimiento: cargos[0] })
      }
      return rows
    }
    buscar()
      .then(rows => setCandidatas((rows ?? []).filter(f => f.estado_factura !== 'pagada' && Number(f.saldo) > 0)))
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { cargarCandidatas('') }, [])

  // Plan de aplicación FIFO: los cargos en orden, hasta llenar el saldo de la factura
  const plan = useMemo(() => {
    if (!facturaSel) return { filas: [], totalAplica: 0, sobra: 0, saldoRestante: 0 }
    let saldoFactura = Number(facturaSel.saldo)
    const filas = []
    for (const c of cargos) {
      const montoCargo = Math.abs(Number(c.monto) || 0)
      const aplica = Math.max(0, Math.min(montoCargo, saldoFactura))
      filas.push({ ...c, montoCargo, aplica, sobra: montoCargo - aplica })
      saldoFactura -= aplica
    }
    const totalAplica = filas.reduce((a, f) => a + f.aplica, 0)
    return { filas, totalAplica, saldoRestante: Number(facturaSel.saldo) - totalAplica, sobraUltimo: filas.reduce((a, f) => a + f.sobra, 0) }
  }, [facturaSel, cargos])

  async function confirmar() {
    if (!facturaSel) return
    const aAplicar = plan.filas.filter(f => f.aplica > 0)
    if (aAplicar.length === 0) return
    setConfirmando(true)
    const tid = toast.loading(`Aplicando ${aAplicar.length} cargos…`)
    try {
      for (const f of aAplicar) {
        await vincularRespaldo({
          movimientoId: f.movimiento_id,
          tipoRespaldo: 'factura_compra',
          facturaId: facturaSel.id,
          monto: f.aplica,
          observaciones: observaciones || `Pago múltiple a folio ${facturaSel.folio}`,
          movimiento: f,
          proveedorNombre: facturaSel.razon_social ?? null,
        })
      }
      toast.success(`${aAplicar.length} cargos aplicados · ${fmtCLP(plan.totalAplica)}`, { id: tid })
      onDone?.()
    } catch (e) {
      toast.error('Error: ' + e.message, { id: tid })
    } finally { setConfirmando(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', border: '1px solid #6366F1', borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
      {/* Header modo múltiple */}
      <div style={{ padding: '14px 16px', background: '#EEF2FF', borderBottom: '1px solid #C7D2FE' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#4338CA', textTransform: 'uppercase' }}>Pago múltiple · {cargos.length} cargos</span>
          <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: '#4338CA' }}>{fmtCLP(sumaCargos)}</span>
        </div>
        <div style={{ fontSize: 11, color: '#6366F1', marginTop: 4 }}>Elige la factura a la que se aplicarán estos {cargos.length} cargos sumados.</div>
      </div>

      {/* Lista de cargos seleccionados */}
      <div style={{ padding: '8px 12px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', maxHeight: 110, overflowY: 'auto' }}>
        {cargos.map(c => (
          <div key={c.movimiento_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0', color: '#475569' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{fmtFecha(c.fecha)} · {c.descripcion}</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmtCLP(c.monto)}</span>
          </div>
        ))}
      </div>

      {/* Buscador de factura */}
      <div style={{ padding: '10px 12px', display: 'flex', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
          <input value={texto} onChange={e => setTexto(e.target.value)} onKeyDown={e => e.key === 'Enter' && cargarCandidatas(texto)}
            placeholder="Buscar la factura destino (RUT, nombre, folio)"
            style={{ width: '100%', padding: '7px 10px 7px 26px', fontSize: 12, borderRadius: 7, border: '1px solid #E2E8F0', boxSizing: 'border-box' }} />
        </div>
        <button onClick={() => cargarCandidatas(texto)} style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #E2E8F0', background: '#fff', fontSize: 12, fontWeight: 600, color: '#475569', cursor: 'pointer' }}>Buscar</button>
      </div>

      {/* Lista de facturas: elegir UNA */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }}>
        {loading && <div style={{ padding: 30, textAlign: 'center', color: '#94A3B8' }}><Loader2 size={16} /></div>}
        {!loading && candidatas.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>Sin facturas candidatas. Busca por proveedor o folio.</div>}
        {!loading && candidatas.map(f => {
          const sel = facturaSel?.id === f.id
          return (
            <div key={f.id} onClick={() => setFacturaSel(sel ? null : f)} style={{
              padding: '9px 10px', marginBottom: 5, cursor: 'pointer',
              background: sel ? '#EFF6FF' : '#fff',
              border: sel ? '1px solid #3B82F6' : '1px solid #E2E8F0', borderRadius: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {sel
                  ? <span style={{ width: 18, height: 18, borderRadius: 99, background: '#3B82F6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Check size={11} /></span>
                  : <span style={{ width: 18, height: 18, borderRadius: 99, border: '2px solid #CBD5E1', flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Folio {f.folio} · {f.razon_social}</div>
                  <div style={{ fontSize: 10, color: '#94A3B8' }}>{fmtFecha(f.fecha_emision)} · {f.estado_factura}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: '#334155' }}>{fmtCLP(f.saldo)}</div>
              </div>
              {sel && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #BFDBFE', fontSize: 11 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ color: '#1D4ED8' }}>Suma de cargos: <b style={{ fontFamily: 'monospace' }}>{fmtCLP(sumaCargos)}</b></span>
                    <span style={{ color: '#1D4ED8' }}>Se aplica: <b style={{ fontFamily: 'monospace' }}>{fmtCLP(plan.totalAplica)}</b></span>
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: plan.saldoRestante <= 0 ? '#DCFCE7' : '#DBEAFE', color: plan.saldoRestante <= 0 ? '#15803D' : '#1D4ED8' }}>
                    {plan.saldoRestante <= 0 ? 'la factura quedará pagada' : `parcial · queda ${fmtCLP(plan.saldoRestante)}`}
                  </span>
                  {plan.sobraUltimo > 0.5 && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 99, background: '#FEF3C7', color: '#92400E', marginLeft: 6 }}>
                      sobran {fmtCLP(plan.sobraUltimo)} de los cargos sin aplicar
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px', borderTop: '1px solid #E2E8F0', background: '#F8FAFC' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={observaciones} onChange={e => setObservaciones(e.target.value)} placeholder="Observación (opcional)"
            style={{ flex: 1, padding: '8px 10px', fontSize: 11, borderRadius: 7, border: '1px solid #E2E8F0' }} />
          <button onClick={confirmar} disabled={!facturaSel || plan.totalAplica <= 0 || confirmando}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 7, border: 'none', background: 'linear-gradient(to bottom, #4338CA, #3730A3)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !facturaSel || plan.totalAplica <= 0 || confirmando ? 0.5 : 1, whiteSpace: 'nowrap' }}>
            {confirmando ? <Loader2 size={13} /> : <Check size={13} />} Aplicar {cargos.length} cargos
          </button>
        </div>
      </div>
    </div>
  )
}
