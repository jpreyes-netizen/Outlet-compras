import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabase'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'

/* ══════════════════════════════════════════════════════════════════════
   BANDEJA DE CONCILIACIÓN — etapa 2 · Pagos
   Una sola cola para todos los detectores, ordenada por confianza.
   Principios de auditoría:
   · Toda sugerencia muestra su EVIDENCIA (por qué el sistema la propone)
   · Aceptar revalida en el servidor (saldos y estados vigentes)
   · Rechazar deja memoria: no vuelve a aparecer
   · Lo auto-aplicado (match exacto, evidencia máxima) se informa, no se esconde
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73'
const ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB', FONDO = '#F9FAFB'
const fmt = n => (n == null || n === '' ? '' : new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n))))
const TH = { padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase',
  letterSpacing: 0.4, borderBottom: `1px solid ${BORDE}`, background: FONDO, position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap' }
const TD = { padding: '6px 8px', fontSize: 12, color: INK, borderBottom: '1px solid #F3F4F6' }
const TDNUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }
const INPUT = { fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${BORDE}`, background: '#fff', color: INK }

const TIPO = {
  fraccionado: { l: 'N pagos → 1 factura', c: '#6941C6' },
  combo: { l: '1 pago → N facturas', c: '#175CD3' },
  exacto_1a1: { l: 'Match exacto', c: VERDE },
}

function Kpi({ label, valor, detalle, color }) {
  return (
    <div style={{ flex: '1 1 160px', minWidth: 150, background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: color || INK, fontFamily: 'ui-monospace, monospace', marginTop: 3 }}>{valor}</div>
      {detalle && <div style={{ fontSize: 10, color: SLATE, marginTop: 2 }}>{detalle}</div>}
    </div>
  )
}

export function BandejaConciliacion({ cu }) {
  const [pendientes, setPendientes] = useState([])
  const [autoAplicadas, setAutoAplicadas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [procesando, setProcesando] = useState(null)
  const [verAuto, setVerAuto] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [{ data: p, error }, { data: a }] = await Promise.all([
        supabase.from('v_bandeja_conciliacion').select('*').order('confianza', { ascending: false }).limit(500),
        supabase.from('v_bandeja_auto_aplicadas').select('*').limit(60),
      ])
      if (error) throw error
      setPendientes(p ?? []); setAutoAplicadas(a ?? [])
    } catch (e) { toast.error('Error: ' + e.message) }
    finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const kpi = useMemo(() => ({
    n: pendientes.length,
    monto: pendientes.reduce((s, p) => s + Number(p.monto_pago || 0), 0),
    altaConfianza: pendientes.filter(p => Number(p.confianza) >= 0.9).length,
    autoHoy: autoAplicadas.length,
    autoMonto: autoAplicadas.reduce((s, a) => s + Number(a.monto_aplicado || 0), 0),
  }), [pendientes, autoAplicadas])

  async function aceptar(s) {
    setProcesando(s.id)
    try {
      const fn = s.tipo === 'fraccionado' ? 'fn_aceptar_pago_fraccionado' : 'fn_aceptar_combo'
      const { data, error } = await supabase.rpc(fn, { p_id: s.id, p_usuario: cu?.id ?? 'ui' })
      if (error) throw error
      toast.success(`Conciliado: ${data.conciliaciones_creadas ?? data.conciliadas} vínculos por ${fmt(s.monto_pago)}`)
      cargar()
    } catch (e) { toast.error(e.message); cargar() } finally { setProcesando(null) }
  }

  async function rechazar(s) {
    const motivo = window.prompt('Motivo del rechazo (queda en auditoría, la sugerencia no volverá a aparecer):')
    if (motivo === null) return
    setProcesando(s.id)
    try {
      const { error } = await supabase.rpc('fn_rechazar_sugerencia', { p_tipo: s.tipo, p_id: s.id, p_usuario: cu?.id ?? 'ui', p_motivo: motivo || null })
      if (error) throw error
      toast.success('Rechazada — no volverá a sugerirse')
      cargar()
    } catch (e) { toast.error(e.message) } finally { setProcesando(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: '#F0F4FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '8px 12px', fontSize: 11.5, color: '#1E3A8A', lineHeight: 1.5 }}>
        <b>Bandeja de sugerencias.</b> Los detectores corren cada noche y proponen vínculos pago↔factura con su evidencia.
        Los <b>match exactos</b> (RUT + monto idénticos) se aplican solos y se informan abajo; el resto espera tu aprobación.
        Aceptar revalida saldos en el servidor; rechazar deja registro y la sugerencia no vuelve.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Kpi label="Sugerencias pendientes" valor={kpi.n} color={kpi.n ? AMBAR : VERDE} detalle={fmt(kpi.monto)} />
        <Kpi label="Alta confianza (≥90%)" valor={kpi.altaConfianza} color={VERDE} detalle="listas para un clic" />
        <Kpi label="Auto-aplicadas (últimas)" valor={kpi.autoHoy} detalle={fmt(kpi.autoMonto) + ' · match exacto y fraccionados'} />
      </div>

      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${BORDE}`, background: FONDO, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>Sugerencias por aprobar</div>
            <div style={{ fontSize: 11, color: SLATE }}>Ordenadas por confianza · la evidencia explica cada propuesta</div>
          </div>
          <button onClick={() => {
            const wb = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pendientes.map(p => ({
              Tipo: TIPO[p.tipo]?.l, Proveedor: p.proveedor, 'Fecha pago': p.fecha_pago, 'Monto pago': p.monto_pago,
              Documentos: p.monto_documentos, Diferencia: p.diferencia, Confianza: p.confianza, Evidencia: p.evidencia,
            }))), 'Bandeja')
            XLSX.writeFile(wb, 'bandeja_conciliacion.xlsx')
          }} style={{ ...INPUT, cursor: 'pointer', fontWeight: 600, color: NAVY }}>Exportar</button>
        </div>
        {cargando ? <div style={{ padding: 28, textAlign: 'center', color: SLATE, fontSize: 12 }}>Cargando…</div>
          : !pendientes.length ? (
            <div style={{ padding: 28, textAlign: 'center', color: VERDE, fontSize: 12, fontWeight: 600 }}>
              Bandeja limpia — no hay sugerencias pendientes de aprobación
            </div>
          ) : (
            <div style={{ maxHeight: '52vh', overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={TH}>Tipo</th><th style={TH}>Proveedor</th><th style={TH}>Fecha pago</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Pago</th><th style={{ ...TH, textAlign: 'right' }}>Documentos</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Dif.</th><th style={TH}>Evidencia</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Confianza</th><th style={TH}></th>
                </tr></thead>
                <tbody>
                  {pendientes.map(s => {
                    const t = TIPO[s.tipo] || {}
                    const conf = Math.round(Number(s.confianza) * 100)
                    return (
                      <tr key={s.id}>
                        <td style={{ ...TD, fontSize: 11, fontWeight: 700, color: t.c, whiteSpace: 'nowrap' }}>{t.l}</td>
                        <td style={{ ...TD, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.proveedor}>{s.proveedor}</td>
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>{s.fecha_pago}</td>
                        <td style={{ ...TDNUM, fontWeight: 600 }}>{fmt(s.monto_pago)}</td>
                        <td style={TDNUM}>{fmt(s.monto_documentos)}</td>
                        <td style={{ ...TDNUM, color: Number(s.diferencia) === 0 ? VERDE : AMBAR }}>{fmt(s.diferencia)}</td>
                        <td style={{ ...TD, fontSize: 11, color: SLATE, maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.evidencia}>{s.evidencia}</td>
                        <td style={{ ...TDNUM, fontWeight: 700, color: conf >= 90 ? VERDE : conf >= 70 ? AMBAR : SLATE }}>{conf}%</td>
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => aceptar(s)} disabled={procesando === s.id}
                              style={{ ...INPUT, cursor: 'pointer', color: '#fff', background: VERDE, border: 'none', fontWeight: 600 }}>
                              {procesando === s.id ? '…' : 'Aceptar'}</button>
                            <button onClick={() => rechazar(s)} disabled={procesando === s.id}
                              style={{ ...INPUT, cursor: 'pointer', color: ROJO, fontWeight: 600 }}>Rechazar</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8, overflow: 'hidden' }}>
        <button onClick={() => setVerAuto(v => !v)} style={{ width: '100%', padding: '10px 12px', background: FONDO,
          border: 'none', borderBottom: verAuto ? `1px solid ${BORDE}` : 'none', cursor: 'pointer', textAlign: 'left',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>
            Conciliaciones automáticas recientes ({autoAplicadas.length})
          </span>
          <span style={{ fontSize: 11, color: SLATE }}>{verAuto ? 'Ocultar' : 'Ver'} · evidencia máxima, aplicadas por el motor nocturno</span>
        </button>
        {verAuto && (
          <div style={{ maxHeight: '34vh', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={TH}>Motor</th><th style={TH}>Fecha pago</th><th style={TH}>Proveedor</th>
                <th style={TH}>Folio</th><th style={{ ...TH, textAlign: 'right' }}>Monto</th></tr></thead>
              <tbody>
                {autoAplicadas.map((a, i) => (
                  <tr key={i}>
                    <td style={{ ...TD, fontSize: 11, fontWeight: 600, color: TIPO[a.motor]?.c || SLATE }}>{TIPO[a.motor]?.l || a.motor}</td>
                    <td style={TD}>{a.fecha_pago}</td>
                    <td style={{ ...TD, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.proveedor}</td>
                    <td style={TD}>{a.folio}</td>
                    <td style={{ ...TDNUM, fontWeight: 600 }}>{fmt(a.monto_aplicado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default BandejaConciliacion
