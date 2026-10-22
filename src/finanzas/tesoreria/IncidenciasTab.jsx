import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { canSync } from '../../core/permisos'
import { DataGrid } from '../conciliacion/DataGrid'
import { formatCLP, parseCLP, todayISO, cardSt, inputSt, selectSt, labelSt, btnSt, btnOutlineSt } from './types'
import {
  fetchSucursales, fetchIncCatalogo, evaluarIncidencia, fetchIncidencias, crearIncidencia,
  cambiarEstadoIncidencia, fetchIncSugeridas, descartarSugerencia, fetchIncidenciaLog,
} from './api'

/* ═══════════════════════════════════════════════════════════════════════════
   INCIDENCIAS DE CIERRE DE CAJA
   Catálogo C1–C9 definido por Administración y Finanzas (Claudia Anabalón, 28-09-2026).
   Ayuda memoria para jefes de tienda y asistentes: qué hacer con cada error o
   descuadre. Las que se escalan avisan a Finanzas por correo en el momento.

   Reglas: la prioridad, si escala y a quién las calcula la BASE (fn_inc_evaluar),
   con la misma función que usa el trigger al guardar. La pantalla solo las muestra;
   no hay forma de bajar una prioridad desde el navegador.
   Decisión C6 (28-09): sin explicación escala SIEMPRE, sin importar el monto.
   ═══════════════════════════════════════════════════════════════════════════ */

const C = {
  azul: '#1F4E79', texto: '#111827', gris: '#6B7280', borde: '#E5E7EB',
  rojo: '#B91C1C', rojoBg: '#FEE2E2', ambar: '#92400E', ambarBg: '#FEF3C7',
  verde: '#047857', verdeBg: '#D1FAE5', grisBg: '#F3F4F6',
}
const fmt = n => formatCLP(n ?? 0)
const PRIO = {
  A: { l: 'A · alta', c: C.rojo, b: C.rojoBg },
  B: { l: 'B · media', c: C.ambar, b: C.ambarBg },
  C: { l: 'C · baja', c: C.gris, b: C.grisBg },
}
const SUC_NOMBRE = { 'suc-lg': 'La Granja', 'suc-la': 'Los Ángeles', 'suc-maipu': 'Tienda Maipú', 'suc-mp': 'CD Maipú', 'suc-web': 'Web' }
const nombreSuc = (id, lista) => lista.find(s => s.id === id)?.nombre ?? SUC_NOMBRE[id] ?? id
const ref = n => `INC-${String(n ?? '').padStart(6, '0')}`
const diasDesde = iso => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null

function Chip({ texto, c, b, title }) {
  return <span title={title} style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 4, fontSize: 10.5, fontWeight: 600, color: c, background: b, whiteSpace: 'nowrap' }}>{texto}</span>
}
const ChipPrio = ({ p }) => p ? <Chip texto={PRIO[p]?.l ?? p} c={PRIO[p]?.c ?? C.gris} b={PRIO[p]?.b ?? C.grisBg} /> : null
const ChipEscala = ({ si }) => si
  ? <Chip texto="SE ESCALA" c="#fff" b={C.rojo} />
  : <Chip texto="se resuelve en tienda" c={C.verde} b={C.verdeBg} />

/* Estados de gestión. 'abierta' es el valor interno de "Pendiente" (nadie la ha tomado). */
const ESTADO = {
  abierta:          { l: 'Pendiente',          c: C.ambar,    b: C.ambarBg, d: 'Registrada; nadie de Finanzas la ha tomado' },
  en_revision:      { l: 'En revisión',        c: '#1E40AF',  b: '#DBEAFE', d: 'Finanzas la está revisando' },
  esperando_tienda: { l: 'Esperando a tienda', c: '#6D28D9',  b: '#EDE9FE', d: 'Finanzas pidió antecedentes a la tienda' },
  cerrada:          { l: 'Cerrada',            c: C.verde,    b: C.verdeBg, d: 'Resuelta, con resolución registrada' },
}
const ORDEN_ESTADOS = ['abierta', 'en_revision', 'esperando_tienda', 'cerrada']
const ChipEstado = ({ e }) => <Chip texto={ESTADO[e]?.l ?? e} c={ESTADO[e]?.c ?? C.gris} b={ESTADO[e]?.b ?? C.grisBg} title={ESTADO[e]?.d} />
const fechaHora = iso => iso ? new Date(iso).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

function FiltroEstados({ valor, onChange, conteo, incluirCerradas = true }) {
  const ops = [['', 'Todas'], ...ORDEN_ESTADOS.filter(e => incluirCerradas || e !== 'cerrada').map(e => [e, ESTADO[e].l])]
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {ops.map(([k, l]) => {
        const on = valor === k
        const col = ESTADO[k]?.c ?? C.azul
        return (
          <button key={k || 'todas'} type="button" onClick={() => onChange(k)} style={{
            padding: '4px 11px', borderRadius: 14, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
            border: `1px solid ${on ? col : C.borde}`, background: on ? col : '#fff', color: on ? '#fff' : C.texto,
          }}>{l} <span style={{ opacity: 0.75 }}>({conteo[k] ?? 0})</span></button>
        )
      })}
    </div>
  )
}

/* ─── Gestión de una incidencia: estado, acciones y bitácora ───
   Las reglas viven en la base (tg_inc_calcular): Finanzas/Dirección mueven cualquier estado;
   la tienda solo responde cuando Finanzas le pidió antecedentes. Aquí solo se ofrecen
   las acciones que la base va a aceptar. */
function GestionIncidencia({ inc, puedeResolver, catalogo, sucursales, onClose, onCambio }) {
  const [log, setLog] = useState(null)
  const [accion, setAccion] = useState(null)   // { estado, label, pide, obligatoria, color }
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const cat = catalogo.find(c => c.codigo === inc.codigo)

  useEffect(() => {
    let vivo = true
    setLog(null)
    fetchIncidenciaLog(inc.id).then(l => { if (vivo) setLog(l) }).catch(() => { if (vivo) setLog([]) })
    return () => { vivo = false }
  }, [inc.id, inc.estado])

  const A = {
    tomar:    { estado: 'en_revision', label: 'Tomar en revisión', pide: 'Nota (opcional): qué vas a revisar', obligatoria: false, color: '#1E40AF' },
    pedir:    { estado: 'esperando_tienda', label: 'Pedir antecedentes a la tienda', pide: 'Qué debe entregar la tienda', obligatoria: true, color: '#6D28D9' },
    retomar:  { estado: 'en_revision', label: 'Retomar revisión', pide: 'Nota (opcional): por qué se retoma sin respuesta', obligatoria: false, color: '#1E40AF' },
    cerrar:   { estado: 'cerrada', label: 'Resolver y cerrar', pide: 'Resolución: qué se verificó y qué se hizo', obligatoria: true, color: C.verde },
    reabrir:  { estado: 'en_revision', label: 'Reabrir', pide: 'Por qué se reabre', obligatoria: true, color: C.ambar },
    soltar:   { estado: 'abierta', label: 'Devolver a pendiente', pide: 'Nota (opcional)', obligatoria: false, color: C.gris },
    responder:{ estado: 'en_revision', label: 'Responder a Finanzas', pide: 'Antecedentes que entregas (qué revisaste, folios, dónde está el respaldo)', obligatoria: true, color: '#1E40AF' },
  }
  const acciones = puedeResolver
    ? { abierta: ['tomar', 'pedir', 'cerrar'], en_revision: ['pedir', 'cerrar', 'soltar'], esperando_tienda: ['retomar', 'cerrar'], cerrada: ['reabrir'] }[inc.estado] ?? []
    : inc.estado === 'esperando_tienda' ? ['responder'] : []

  async function confirmar() {
    if (accion.obligatoria && nota.trim().length < 5) { toast.error(accion.pide); return }
    setGuardando(true)
    try {
      const upd = await cambiarEstadoIncidencia(inc.id, accion.estado, nota)
      toast.success(`${ref(inc.numero)} · ${ESTADO[upd.estado]?.l ?? upd.estado}`)
      setAccion(null); setNota('')
      onCambio(upd)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo cambiar el estado')
    } finally { setGuardando(false) }
  }

  const dato = (l, v) => v ? <div><span style={{ color: C.gris }}>{l}: </span>{v}</div> : null

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...cardSt, width: 'min(720px, 96vw)', maxHeight: '90vh', overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>{ref(inc.numero)}</strong>
            <ChipEstado e={inc.estado} />
            <ChipPrio p={inc.prioridad} />
            <ChipEscala si={inc.escala} />
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.gris }}><X size={17} /></button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{inc.codigo} · {cat?.nombre ?? inc.codigo}
            <span style={{ fontWeight: 400, color: C.gris }}> · {nombreSuc(inc.sucursal_id, sucursales)} · {inc.fecha}</span></div>
          <strong style={{ fontSize: 15 }}>{fmt(inc.monto)}</strong>
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>{inc.detalle}</div>
        <div style={{ fontSize: 11.5, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 16px' }}>
          {dato('Acción', inc.escala_a)}
          {dato('Vendedor', inc.vendedor_nombre)}
          {dato('N° doc', inc.n_documento)}
          {dato('Registró', inc.registrado_por_nombre)}
          {dato('Responsable Finanzas', inc.responsable_nombre)}
          {dato('Último cambio', inc.estado_at ? `${fechaHora(inc.estado_at)} · ${inc.estado_por_nombre ?? '—'}` : null)}
        </div>

        {/* Situación actual */}
        {inc.estado === 'esperando_tienda' && inc.estado_nota && (
          <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#5B21B6' }}>
            <strong>Finanzas pide a la tienda:</strong> {inc.estado_nota}
          </div>
        )}
        {inc.estado === 'cerrada' && inc.resolucion && (
          <div style={{ background: C.verdeBg, borderRadius: 8, padding: '9px 12px', fontSize: 12, color: C.verde }}>
            <strong>Resolución:</strong> {inc.resolucion} {inc.resuelto_por_nombre && <span>· {inc.resuelto_por_nombre}</span>}
          </div>
        )}

        {/* Acciones */}
        {acciones.length > 0 && !accion && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {acciones.map(k => (
              <button key={k} type="button" onClick={() => { setAccion(A[k]); setNota('') }}
                style={k === 'cerrar' || k === 'responder' ? btnSt(A[k].color) : { ...btnOutlineSt, color: A[k].color, borderColor: A[k].color }}>
                {A[k].label}
              </button>
            ))}
          </div>
        )}
        {accion && (
          <div style={{ border: `1px solid ${accion.color}`, borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: accion.color }}>
              {accion.label} → {ESTADO[accion.estado].l}
            </div>
            <textarea rows={3} autoFocus style={{ ...inputSt, fontFamily: 'inherit', resize: 'vertical' }}
              placeholder={accion.pide} value={nota} onChange={e => setNota(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setAccion(null)} style={btnOutlineSt}>Cancelar</button>
              <button type="button" onClick={confirmar} disabled={guardando}
                style={{ ...btnSt(accion.color), opacity: guardando ? 0.6 : 1 }}>{guardando && <Loader2 size={13} />}Confirmar</button>
            </div>
          </div>
        )}
        {!puedeResolver && inc.estado !== 'esperando_tienda' && inc.estado !== 'cerrada' && (
          <div style={{ fontSize: 11, color: C.gris }}>La gestión la lleva Finanzas. Si te piden antecedentes, aquí aparecerá el botón para responder.</div>
        )}

        {/* Bitácora */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.gris, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Historial de gestión</div>
          {log === null && <div style={{ fontSize: 11.5, color: C.gris }}><Loader2 size={12} /> Cargando…</div>}
          {log?.length === 0 && <div style={{ fontSize: 11.5, color: C.gris }}>Sin movimientos registrados.</div>}
          {log?.map(l => (
            <div key={l.id} style={{ display: 'flex', gap: 10, padding: '6px 0', borderTop: '1px solid #F1F5F9', fontSize: 11.5 }}>
              <div style={{ width: 92, color: C.gris, flexShrink: 0 }}>{fechaHora(l.created_at)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {l.estado_anterior && <><ChipEstado e={l.estado_anterior} /><span style={{ color: C.gris }}>→</span></>}
                  <ChipEstado e={l.estado_nuevo} />
                  <span style={{ color: C.gris }}>{l.usuario_nombre ?? 'sistema'}</span>
                </div>
                {l.nota && <div style={{ marginTop: 3, color: C.texto }}>{l.nota}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, valor, sub, color = C.azul }) {
  return (
    <div style={{ ...cardSt, padding: '10px 14px' }}>
      <div style={{ fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1.2 }}>{valor}</div>
      {sub && <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const SiNo = ({ valor, onChange, disabled }) => (
  <div style={{ display: 'flex', gap: 6 }}>
    {[['si', 'Sí'], ['no', 'No']].map(([v, l]) => (
      <button key={v} type="button" disabled={disabled} onClick={() => onChange(v)}
        style={{ ...btnOutlineSt, padding: '5px 16px', fontSize: 12,
          ...(valor === v ? { background: C.azul, color: '#fff', border: `1px solid ${C.azul}` } : {}) }}>{l}</button>
    ))}
  </div>
)

/* ─── Formulario guiado ─── */
const VACIO = { fecha: todayISO(), sucursal_id: '', codigo: '', monto: 0, explicado: '', impide_cuadrar: '',
  n_documento: '', vendedor_nombre: '', bsale_vendedor_id: null, emisor_documento: '', detalle: '', cierre_id: null, sugerencia_clave: null }

function FormularioIncidencia({ catalogo, sucursales, sucursalFija, inicial, onGuardada, onCancelar }) {
  const [f, setF] = useState(() => ({ ...VACIO, sucursal_id: sucursalFija || '', ...(inicial ?? {}) }))
  const [evalRes, setEvalRes] = useState(null)
  const [evaluando, setEvaluando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const cat = catalogo.find(c => c.codigo === f.codigo)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  // Vista previa con la misma regla de la base; se recalcula al cambiar lo que la afecta
  useEffect(() => {
    if (!f.codigo || !f.fecha) { setEvalRes(null); return }
    let vivo = true
    setEvaluando(true)
    const t = setTimeout(() => {
      evaluarIncidencia({ ...f, explicado: f.explicado || 'no_aplica', impide_cuadrar: f.impide_cuadrar || 'no_aplica' })
        .then(r => { if (vivo) setEvalRes(r) }).catch(() => { if (vivo) setEvalRes(null) })
        .finally(() => { if (vivo) setEvaluando(false) })
    }, 250)
    return () => { vivo = false; clearTimeout(t) }
  }, [f.codigo, f.monto, f.explicado, f.impide_cuadrar, f.fecha, f.vendedor_nombre, f.bsale_vendedor_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const faltaPregunta = cat && ((cat.pide_explicacion && !['si', 'no'].includes(f.explicado))
    || (cat.pide_impide_cuadrar && !['si', 'no'].includes(f.impide_cuadrar)))
  const faltaBase = !f.fecha || !f.sucursal_id || !f.codigo
  const faltaDetalle = !f.detalle || f.detalle.trim().length < 10

  async function guardar() {
    if (faltaBase) { toast.error('Completa fecha, sucursal y código'); return }
    if (faltaPregunta) { toast.error('Responde la pregunta de contexto: decide si la incidencia escala'); return }
    if (faltaDetalle) { toast.error(`Describe la incidencia (${cat?.que_anotar ?? 'antecedentes'})`); return }
    setGuardando(true)
    try {
      const inc = await crearIncidencia({ ...f, explicado: f.explicado || 'no_aplica', impide_cuadrar: f.impide_cuadrar || 'no_aplica' })
      onGuardada(inc)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo registrar')
    } finally { setGuardando(false) }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: 14 }}>
      <div style={{ ...cardSt, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 11 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.texto }}>
            {f.sugerencia_clave ? 'Registrar incidencia sugerida por el sistema' : 'Registrar incidencia'}
          </div>
          {onCancelar && <button type="button" onClick={onCancelar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.gris }}><X size={16} /></button>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelSt}>Fecha</label>
            <input type="date" style={inputSt} value={f.fecha} max={todayISO()} onChange={e => set('fecha', e.target.value)} />
          </div>
          <div>
            <label style={labelSt}>Sucursal</label>
            <select style={selectSt} value={f.sucursal_id} disabled={!!sucursalFija} onChange={e => set('sucursal_id', e.target.value)}>
              <option value="">Selecciona…</option>
              {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label style={labelSt}>Código de incidencia</label>
          <select style={selectSt} value={f.codigo} onChange={e => setF(p => ({ ...p, codigo: e.target.value, explicado: '', impide_cuadrar: '' }))}>
            <option value="">Selecciona el tipo de incidencia…</option>
            {catalogo.map(c => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </div>
        <div>
          <label style={labelSt}>Monto</label>
          <input style={inputSt} inputMode="numeric" value={f.monto ? formatCLP(f.monto) : ''} placeholder="$0"
            onChange={e => set('monto', parseCLP(e.target.value))} />
        </div>

        {/* Pregunta de contexto: solo la que aplica al código elegido */}
        {cat?.pide_explicacion && (
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '9px 12px' }}>
            <label style={{ ...labelSt, color: '#1E40AF' }}>{cat.etiqueta_explicacion} <span style={{ color: C.rojo }}>*</span></label>
            <SiNo valor={f.explicado} onChange={v => set('explicado', v)} />
            <div style={{ fontSize: 10.5, color: '#1E40AF', marginTop: 5 }}>
              {f.codigo === 'C6'
                ? 'Si no se explica, escala a Finanzas cualquiera sea el monto. Sobre $50.000 escala siempre.'
                : 'Sin documento asociado, escala a Finanzas el mismo día.'}
            </div>
          </div>
        )}
        {cat?.pide_impide_cuadrar && (
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '9px 12px' }}>
            <label style={{ ...labelSt, color: '#1E40AF' }}>¿La ausencia del cierre impide cuadrar el día? <span style={{ color: C.rojo }}>*</span></label>
            <SiNo valor={f.impide_cuadrar} onChange={v => set('impide_cuadrar', v)} />
          </div>
        )}
        {cat?.pide_repeticion && (
          <div style={{ fontSize: 10.5, color: C.gris }}>
            La repetición (3 o más veces, misma persona, mismo mes) la cuenta el ERP con las incidencias ya registradas.
            Indica el vendedor para que el conteo sea exacto.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelSt}>N° documento</label>
            <input style={inputSt} value={f.n_documento} onChange={e => set('n_documento', e.target.value)} placeholder={cat?.pide_documento ? 'Folio' : 'N/A'} />
          </div>
          <div>
            <label style={labelSt}>Vendedor</label>
            <input style={inputSt} value={f.vendedor_nombre} onChange={e => setF(p => ({ ...p, vendedor_nombre: e.target.value, bsale_vendedor_id: null }))} placeholder="Nombre" />
          </div>
          <div>
            <label style={labelSt}>Emisor del documento</label>
            <input style={inputSt} value={f.emisor_documento} onChange={e => set('emisor_documento', e.target.value)} placeholder="N/A" />
          </div>
        </div>
        <div>
          <label style={labelSt}>Detalle <span style={{ color: C.rojo }}>*</span></label>
          <textarea rows={3} style={{ ...inputSt, resize: 'vertical', fontFamily: 'inherit' }} value={f.detalle}
            onChange={e => set('detalle', e.target.value)}
            placeholder={cat ? `Anota: ${cat.que_anotar}` : 'Describe qué pasó y con qué antecedentes'} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {onCancelar && <button type="button" onClick={onCancelar} style={btnOutlineSt}>Cancelar</button>}
          <button type="button" onClick={guardar} disabled={guardando}
            style={{ ...btnSt(evalRes?.escala ? C.rojo : C.azul), opacity: guardando ? 0.6 : 1 }}>
            {guardando && <Loader2 size={13} />}
            {evalRes?.escala ? 'Registrar y escalar a Finanzas' : 'Registrar incidencia'}
          </button>
        </div>
      </div>

      {/* Ayuda memoria: qué implica la incidencia y qué hacer */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!cat && (
          <div style={{ ...cardSt, padding: '14px 16px', fontSize: 12, color: C.gris, lineHeight: 1.5 }}>
            Elige el código y aquí verás qué debes anotar, por qué importa y si la incidencia se escala a Finanzas.
          </div>
        )}
        {cat && (
          <>
            <div style={{
              borderRadius: 10, padding: '13px 15px',
              background: evalRes?.escala ? C.rojo : evalRes ? C.verdeBg : C.grisBg,
              color: evalRes?.escala ? '#fff' : evalRes ? C.verde : C.gris,
            }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.85 }}>
                {evaluando ? 'Evaluando…' : 'Qué hacer'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3, display: 'flex', alignItems: 'center', gap: 7 }}>
                {evalRes?.escala ? <AlertTriangle size={17} /> : evalRes ? <CheckCircle2 size={17} /> : null}
                {faltaPregunta ? 'Responde la pregunta de contexto'
                  : evalRes?.escala ? 'SE ESCALA A FINANZAS' : evalRes ? 'Se resuelve y documenta en la tienda' : '—'}
              </div>
              {!faltaPregunta && evalRes && (
                <div style={{ fontSize: 12, marginTop: 5, lineHeight: 1.45 }}>
                  {evalRes.escala_a}
                  {evalRes.escala && ' · Al registrarla se avisa por correo a la Jefatura de Administración y Finanzas.'}
                </div>
              )}
              {!faltaPregunta && evalRes && (
                <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11 }}>Prioridad</span>
                  <span style={{ background: '#fff', color: PRIO[evalRes.prioridad]?.c ?? C.gris, borderRadius: 4, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>
                    {evalRes.prioridad ?? '—'}
                  </span>
                  {cat.pide_repeticion && evalRes.repeticiones_mes > 0 && (
                    <span style={{ fontSize: 11 }}>· {evalRes.repeticiones_mes}ª vez este mes</span>
                  )}
                </div>
              )}
            </div>
            <div style={{ ...cardSt, padding: '12px 15px', display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.gris, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Qué anotar en la ficha</div>
                <div style={{ fontSize: 12.5, color: C.texto, marginTop: 2 }}>{cat.que_anotar}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.gris, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Por qué importa</div>
                <div style={{ fontSize: 12, color: C.gris, marginTop: 2 }}>{cat.por_que_importa}</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ═════════════════════════ COMPONENTE PRINCIPAL ═════════════════════════ */
export function IncidenciasTab({ usuario, cu }) {
  const puedeResolver = canSync(cu, 'finanzas', 'fin.teso.incidencias.resolver') !== false
  // Quien no resuelve trabaja sobre su sucursal; Finanzas y Dirección ven todas
  const sucursalFija = !puedeResolver && usuario?.sucursal_id ? usuario.sucursal_id : ''

  const [seccion, setSeccion] = useState(puedeResolver ? 'bandeja' : 'registrar')
  const [catalogo, setCatalogo] = useState([])
  const [sucursales, setSucursales] = useState([])
  const [sucursalSel, setSucursalSel] = useState(sucursalFija)
  const [incidencias, setIncidencias] = useState([])
  const [sugeridas, setSugeridas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [prefill, setPrefill] = useState(null)
  const [formKey, setFormKey] = useState(0)
  const [ultima, setUltima] = useState(null)
  const [gestion, setGestion] = useState(null)        // incidencia abierta en el panel de gestión
  const [filtroEstado, setFiltroEstado] = useState('')
  const [descartando, setDescartando] = useState(null)
  const [motivo, setMotivo] = useState('')

  useEffect(() => {
    fetchIncCatalogo().then(setCatalogo).catch(() => toast.error('No se pudo cargar el catálogo de incidencias'))
    fetchSucursales().then(s => setSucursales((s ?? []).filter(x => x.id !== 'suc-web'))).catch(() => {})
  }, [])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [inc, sug] = await Promise.all([
        fetchIncidencias({ sucursal_id: sucursalSel || null }),
        fetchIncSugeridas({ sucursal_id: sucursalSel || null }).catch(() => []),
      ])
      setIncidencias(inc); setSugeridas(sug)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cargar incidencias')
    } finally { setCargando(false) }
  }, [sucursalSel])
  useEffect(() => { cargar() }, [cargar])

  // Bandeja de Finanzas: escaladas que aún no se cierran, en cualquier estado de gestión
  const escaladasActivas = useMemo(() => incidencias.filter(i => i.escala && i.estado !== 'cerrada'), [incidencias])
  const bandeja = useMemo(() => escaladasActivas
    .filter(i => !filtroEstado || filtroEstado === 'cerrada' || i.estado === filtroEstado)
    .sort((a, b) => (a.prioridad ?? 'Z').localeCompare(b.prioridad ?? 'Z') || a.registrado_at.localeCompare(b.registrado_at)),
  [escaladasActivas, filtroEstado])

  const contar = lista => lista.reduce((a, i) => ({ ...a, [i.estado]: (a[i.estado] ?? 0) + 1 }), { '': lista.length })
  const conteoTodas = useMemo(() => contar(incidencias), [incidencias]) // eslint-disable-line react-hooks/exhaustive-deps
  const conteoBandeja = useMemo(() => contar(escaladasActivas), [escaladasActivas]) // eslint-disable-line react-hooks/exhaustive-deps
  const registroFiltrado = useMemo(() => filtroEstado ? incidencias.filter(i => i.estado === filtroEstado) : incidencias, [incidencias, filtroEstado])

  const kpi = useMemo(() => {
    const total = incidencias.length
    const esc = incidencias.filter(i => i.escala).length
    const vencidas = escaladasActivas.filter(i => i.fecha < todayISO()).length
    return { total, esc, pct: total ? Math.round(100 * esc / total) : 0, vencidas }
  }, [incidencias, escaladasActivas])

  function registrarDesdeSugerencia(s) {
    setPrefill({
      fecha: s.fecha, sucursal_id: s.sucursal_id, codigo: s.codigo, monto: Math.abs(Number(s.monto) || 0),
      vendedor_nombre: s.vendedor_nombre ?? '', bsale_vendedor_id: s.bsale_vendedor_id ?? null,
      n_documento: s.n_documento ?? '', detalle: s.detalle ?? '', cierre_id: s.cierre_id ?? null, sugerencia_clave: s.clave,
      explicado: '', impide_cuadrar: '',
    })
    setFormKey(k => k + 1); setUltima(null); setSeccion('registrar')
  }

  function onGuardada(inc) {
    setUltima(inc); setPrefill(null); setFormKey(k => k + 1)
    toast.success(`${ref(inc.numero)} registrada${inc.escala ? ' y escalada a Finanzas' : ''}`)
    cargar()
  }

  function onCambioEstado(upd) {
    setIncidencias(prev => prev.map(i => i.id === upd.id ? upd : i))
    setGestion(upd)
  }
  async function confirmarDescarte() {
    try {
      await descartarSugerencia(descartando.clave, motivo)
      toast.success('Sugerencia descartada'); setDescartando(null); setMotivo(''); cargar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo descartar') }
  }

  const catNombre = cod => catalogo.find(c => c.codigo === cod)?.nombre ?? cod

  const colsRegistro = useMemo(() => [
    { key: 'numero', label: 'N°', width: 92, value: r => r.numero, render: r => <strong>{ref(r.numero)}</strong> },
    { key: 'fecha', label: 'Fecha', width: 90 },
    { key: 'sucursal_id', label: 'Sucursal', width: 105, value: r => nombreSuc(r.sucursal_id, sucursales), render: r => nombreSuc(r.sucursal_id, sucursales) },
    { key: 'codigo', label: 'Código', width: 64 },
    { key: 'incidencia', label: 'Incidencia', width: 200, value: r => catNombre(r.codigo), render: r => catNombre(r.codigo) },
    { key: 'monto', label: 'Monto', width: 105, align: 'right', render: r => fmt(r.monto) },
    { key: 'prioridad', label: 'Prioridad', width: 88, render: r => <ChipPrio p={r.prioridad} /> },
    { key: 'escala', label: '¿Escala?', width: 130, value: r => r.escala ? 'SÍ' : 'NO', render: r => <ChipEscala si={r.escala} /> },
    { key: 'escala_a', label: 'Escala a / Acción', width: 230 },
    { key: 'vendedor_nombre', label: 'Vendedor', width: 150 },
    { key: 'n_documento', label: 'N° doc', width: 90 },
    { key: 'detalle', label: 'Detalle', width: 280 },
    { key: 'registrado_por_nombre', label: 'Registró', width: 140 },
    { key: 'estado', label: 'Estado', width: 130, value: r => ESTADO[r.estado]?.l ?? r.estado, render: r => <ChipEstado e={r.estado} /> },
    { key: 'responsable_nombre', label: 'Responsable', width: 140 },
    { key: 'estado_at', label: 'Último cambio', width: 120, value: r => r.estado_at, render: r => fechaHora(r.estado_at) },
    { key: 'estado_nota', label: 'Última nota', width: 240 },
    { key: 'resuelto_por_nombre', label: 'Resolvió', width: 140 },
    { key: 'resolucion', label: 'Resolución', width: 240 },
    { key: 'origen', label: 'Origen', width: 90, render: r => r.origen === 'sugerida' ? 'sistema' : 'manual' },
  ], [catalogo, sucursales]) // eslint-disable-line react-hooks/exhaustive-deps

  const colsSugeridas = useMemo(() => [
    { key: 'fecha', label: 'Fecha', width: 90 },
    { key: 'sucursal_id', label: 'Sucursal', width: 105, value: r => nombreSuc(r.sucursal_id, sucursales), render: r => nombreSuc(r.sucursal_id, sucursales) },
    { key: 'codigo', label: 'Código', width: 64 },
    { key: 'incidencia', label: 'Incidencia', width: 190 },
    { key: 'monto', label: 'Monto', width: 105, align: 'right', render: r => fmt(Math.abs(Number(r.monto) || 0)) },
    { key: 'vendedor_nombre', label: 'Persona', width: 150 },
    { key: 'detalle', label: 'Lo que vio el sistema', width: 360 },
    { key: 'fuente', label: 'Fuente', width: 130 },
    {
      key: 'acciones', label: '', width: 190, sortable: false, filterable: false,
      render: r => (
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <button type="button" onClick={e => { e.stopPropagation(); registrarDesdeSugerencia(r) }}
            style={{ ...btnSt(), padding: '3px 10px', fontSize: 11 }}>Registrar</button>
          <button type="button" onClick={e => { e.stopPropagation(); setDescartando(r); setMotivo('') }}
            style={{ ...btnOutlineSt, padding: '3px 10px', fontSize: 11 }}>Descartar</button>
        </span>
      ),
    },
  ], [sucursales]) // eslint-disable-line react-hooks/exhaustive-deps

  const SECCIONES = [
    { k: 'registrar', l: 'Registrar' },
    { k: 'sugeridas', l: `Sugeridas por el sistema${sugeridas.length ? ` (${sugeridas.length})` : ''}` },
    { k: 'bandeja', l: `Escaladas a Finanzas${escaladasActivas.length ? ` (${escaladasActivas.length})` : ''}` },
    { k: 'registro', l: `Registro${incidencias.length ? ` (${incidencias.length})` : ''}` },
    { k: 'catalogo', l: 'Catálogo' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Filtro y KPIs */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 210 }}>
          <label style={labelSt}>Sucursal</label>
          <select style={selectSt} value={sucursalSel} disabled={!!sucursalFija} onChange={e => setSucursalSel(e.target.value)}>
            <option value="">Todas</option>
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <button type="button" onClick={cargar} disabled={cargando} style={{ ...btnSt('#6B7280'), padding: '8px 12px' }} title="Recargar">
          {cargando ? <Loader2 size={14} /> : <RefreshCw size={14} />}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Kpi label="Registradas" valor={kpi.total} />
        <Kpi label="Escaladas" valor={kpi.esc} sub={`${kpi.pct}% del total`} color={C.rojo} />
        <Kpi label="Pendientes" valor={conteoTodas.abierta ?? 0} sub="nadie las ha tomado" color={conteoTodas.abierta ? C.ambar : C.verde} />
        <Kpi label="En revisión" valor={conteoTodas.en_revision ?? 0} sub="Finanzas las está viendo" color="#1E40AF" />
        <Kpi label="Esperando a tienda" valor={conteoTodas.esperando_tienda ?? 0} sub="antecedentes pedidos" color={conteoTodas.esperando_tienda ? '#6D28D9' : C.verde} />
        <Kpi label="Fuera de plazo" valor={kpi.vencidas} sub="escaladas de días anteriores sin cerrar" color={kpi.vencidas ? C.rojo : C.verde} />
        <Kpi label="Sugeridas por revisar" valor={sugeridas.length} color={sugeridas.length ? C.ambar : C.verde} />
      </div>

      {!puedeResolver && (conteoTodas.esperando_tienda ?? 0) > 0 && (
        <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12.5, color: '#5B21B6' }}>
            <strong>Finanzas te pidió antecedentes en {conteoTodas.esperando_tienda} incidencia{conteoTodas.esperando_tienda > 1 ? 's' : ''}.</strong> Ábrelas y responde para que puedan cerrarse.
          </div>
          <button type="button" onClick={() => { setFiltroEstado('esperando_tienda'); setSeccion('registro') }} style={btnSt('#6D28D9')}>Ver y responder</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid rgba(0,0,0,0.06)', overflowX: 'auto' }}>
        {SECCIONES.map(s => (
          <button key={s.k} type="button" onClick={() => setSeccion(s.k)} style={{
            padding: '7px 14px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', background: 'none', border: 'none', cursor: 'pointer',
            color: seccion === s.k ? C.azul : '#8E8E93', borderBottom: seccion === s.k ? `2px solid ${C.azul}` : '2px solid transparent',
          }}>{s.l}</button>
        ))}
      </div>

      {/* ═══ REGISTRAR ═══ */}
      {seccion === 'registrar' && (
        <>
          {ultima && (
            <div style={{
              borderRadius: 10, padding: '11px 15px', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center',
              background: ultima.escala ? C.rojo : C.verdeBg, color: ultima.escala ? '#fff' : C.verde,
            }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                <strong>{ref(ultima.numero)} · {ultima.codigo} {catNombre(ultima.codigo)}</strong>
                {ultima.escala
                  ? <> — escalada a Finanzas. {ultima.escala_a}. Se avisó por correo a la Jefatura de Administración y Finanzas.
                      {' '}Ten a mano: {catalogo.find(c => c.codigo === ultima.codigo)?.que_anotar}.</>
                  : <> — registrada. {ultima.escala_a}.</>}
              </div>
              <button type="button" onClick={() => setUltima(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={16} /></button>
            </div>
          )}
          {catalogo.length > 0 && (
            <FormularioIncidencia key={formKey} catalogo={catalogo} sucursales={sucursales} sucursalFija={sucursalFija}
              inicial={prefill} onGuardada={onGuardada} onCancelar={prefill ? () => { setPrefill(null); setFormKey(k => k + 1) } : null} />
          )}
        </>
      )}

      {/* ═══ SUGERIDAS ═══ */}
      {seccion === 'sugeridas' && (
        <>
          <div style={{ ...cardSt, padding: '11px 15px', fontSize: 12, color: C.texto, lineHeight: 1.5 }}>
            <strong>Casos que el sistema detectó en los últimos 30 días</strong> a partir de los cierres, el arqueo, los pagos de
            BSALE, las notas de crédito y los abonos. Revisa cada uno: si corresponde, <em>Registrar</em> abre la incidencia con los
            datos cargados para que completes la explicación; si no corresponde, <em>Descartar</em> exige el motivo y queda a tu nombre.
          </div>
          <DataGrid columns={colsSugeridas} rows={sugeridas} getRowId={r => r.clave} title="Incidencias sugeridas"
            exportName="incidencias_sugeridas" loading={cargando} emptyText="No hay casos pendientes de revisar" />
        </>
      )}

      {/* ═══ BANDEJA FINANZAS ═══ */}
      {seccion === 'bandeja' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <FiltroEstados valor={filtroEstado === 'cerrada' ? '' : filtroEstado} onChange={setFiltroEstado} conteo={conteoBandeja} incluirCerradas={false} />
          {bandeja.length === 0 && !cargando && (
            <div style={{ ...cardSt, padding: '18px', textAlign: 'center', fontSize: 12.5, color: C.verde }}>
              {filtroEstado ? `No hay escaladas en estado "${ESTADO[filtroEstado]?.l}".` : 'No hay incidencias escaladas sin cerrar.'}
            </div>
          )}
          {bandeja.map(i => {
            const cat = catalogo.find(c => c.codigo === i.codigo)
            const dias = diasDesde(i.registrado_at)
            const vencida = i.fecha < todayISO()
            return (
              <div key={i.id} style={{ ...cardSt, padding: '12px 15px', borderLeft: `4px solid ${PRIO[i.prioridad]?.c ?? C.gris}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13 }}>{ref(i.numero)}</strong>
                    <ChipEstado e={i.estado} />
                    <ChipPrio p={i.prioridad} />
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{i.codigo} · {cat?.nombre}</span>
                    <span style={{ fontSize: 12, color: C.gris }}>{nombreSuc(i.sucursal_id, sucursales)} · {i.fecha}</span>
                    {vencida && <Chip texto={`fuera de plazo · ${dias} d`} c="#fff" b={C.rojo} title="El plazo es el mismo día" />}
                  </div>
                  <strong style={{ fontSize: 15 }}>{fmt(i.monto)}</strong>
                </div>
                <div style={{ fontSize: 12, color: C.texto, marginTop: 6, lineHeight: 1.5 }}>{i.detalle}</div>
                <div style={{ fontSize: 11, color: C.gris, marginTop: 5, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <span>Acción: {i.escala_a}</span>
                  {i.vendedor_nombre && <span>Vendedor: {i.vendedor_nombre}</span>}
                  {i.n_documento && <span>Doc: {i.n_documento}</span>}
                  <span>Registró: {i.registrado_por_nombre ?? '—'}</span>
                  {i.origen === 'sugerida' && <span>Detectada por el sistema</span>}
                </div>
                {cat && <div style={{ fontSize: 11, color: C.gris, marginTop: 3 }}>Debe venir: {cat.que_anotar}</div>}
                {i.estado !== 'abierta' && (
                  <div style={{ fontSize: 11, marginTop: 5, color: ESTADO[i.estado]?.c }}>
                    {ESTADO[i.estado]?.l}{i.responsable_nombre && ` · ${i.responsable_nombre}`} · desde {fechaHora(i.estado_at)}
                    {i.estado_nota && <span style={{ color: C.texto }}> — {i.estado_nota}</span>}
                  </div>
                )}
                <div style={{ marginTop: 9 }}>
                  <button type="button" onClick={() => setGestion(i)} style={{ ...btnOutlineSt, fontSize: 11.5 }}>
                    {puedeResolver ? 'Gestionar' : i.estado === 'esperando_tienda' ? 'Responder' : 'Ver historial'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ═══ REGISTRO ═══ */}
      {seccion === 'registro' && (
        <>
          <FiltroEstados valor={filtroEstado} onChange={setFiltroEstado} conteo={conteoTodas} />
          <DataGrid columns={colsRegistro} rows={registroFiltrado} getRowId={r => r.id} title="Registro de incidencias"
            exportName="registro_incidencias" loading={cargando} emptyText={filtroEstado ? 'No hay incidencias en ese estado' : 'Aún no hay incidencias registradas'}
            selectedId={gestion?.id} onRowClick={r => setGestion(r)} />
          <div style={{ fontSize: 11, color: C.gris }}>Haz clic en una fila para ver su historial y cambiar el estado.</div>
        </>
      )}

      {/* ═══ CATÁLOGO ═══ */}
      {seccion === 'catalogo' && (
        <div style={{ ...cardSt, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                {['Código', 'Incidencia', 'Prioridad base', 'Escala', 'Escala a', 'Qué anotar en la ficha', 'Por qué importa'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 10.5, color: C.gris, borderBottom: `1px solid ${C.borde}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalogo.map(c => (
                <tr key={c.codigo} style={{ borderBottom: '1px solid #F1F5F9', verticalAlign: 'top' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 700 }}>{c.codigo}</td>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>{c.nombre}</td>
                  <td style={{ padding: '8px 10px' }}>{c.prioridad_base}</td>
                  <td style={{ padding: '8px 10px' }}>{c.codigo === 'C6' ? 'Sí, si no se explica o supera $50.000' : c.escala_base}</td>
                  <td style={{ padding: '8px 10px' }}>{c.escala_a}</td>
                  <td style={{ padding: '8px 10px' }}>{c.que_anotar}</td>
                  <td style={{ padding: '8px 10px', color: C.gris }}>{c.por_que_importa}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gestion && (
        <GestionIncidencia inc={gestion} puedeResolver={puedeResolver} catalogo={catalogo} sucursales={sucursales}
          onClose={() => setGestion(null)} onCambio={onCambioEstado} />
      )}

      {/* Descarte de sugerencia: exige motivo */}
      {descartando && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ ...cardSt, width: 'min(460px, 92vw)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Descartar sugerencia · {descartando.codigo} {descartando.incidencia}</div>
            <div style={{ fontSize: 11.5, color: C.gris }}>{descartando.detalle}</div>
            <textarea rows={3} autoFocus style={{ ...inputSt, fontFamily: 'inherit' }} value={motivo} onChange={e => setMotivo(e.target.value)}
              placeholder="Por qué no corresponde registrarla (queda a tu nombre)" />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setDescartando(null)} style={btnOutlineSt}>Cancelar</button>
              <button type="button" onClick={confirmarDescarte} disabled={motivo.trim().length < 10} style={{ ...btnSt(), opacity: motivo.trim().length < 10 ? 0.5 : 1 }}>Descartar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
