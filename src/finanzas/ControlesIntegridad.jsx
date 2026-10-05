import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import { exportarExcel, exportarPDF } from './exportUtils'

/* ══════════════════════════════════════════════════════════════════════
   CONTROLES DE INTEGRIDAD — el cockpit de cierre
   Veinte controles permanentes sobre la contabilidad vigente, con su
   equivalente de estándar (SAP FI/CO, NIC) y la acción que corresponde.
   Responde una sola pregunta: ¿se puede confiar hoy en los números?
   Fuentes: v_auditoria_contable (controles) · v_auditoria_periodos (meses)
   ══════════════════════════════════════════════════════════════════════ */
const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', ROJO = '#B42318', VERDE = '#1E7A44', AMBAR = '#B25E09', BORDE = '#E5E7EB'
const COLOR = { ok: VERDE, alerta: AMBAR, critico: ROJO }
const ETIQ = { ok: 'OK', alerta: 'ALERTA', critico: 'CRÍTICO' }
const fmt = n => n == null ? '—' : '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(Number(n)))
const TH = { textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: SLATE, padding: '7px 10px', borderBottom: `1px solid ${NAVY}`, whiteSpace: 'nowrap' }
const TD = { fontSize: 12.5, padding: '7px 10px', borderBottom: '1px solid #F3F4F6', verticalAlign: 'top' }
const NUM = { ...TD, textAlign: 'right', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }
const BTN = { fontSize: 12, padding: '5px 10px', border: `1px solid ${BORDE}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontWeight: 600, color: NAVY }

export function ControlesIntegridad() {
  const [ctrl, setCtrl] = useState([])
  const [meses, setMeses] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const [soloProblemas, setSoloProblemas] = useState(false)
  const [at, setAt] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    const [c, m] = await Promise.all([
      supabase.from('v_auditoria_contable').select('*').order('orden'),
      supabase.from('v_auditoria_periodos').select('*').order('periodo'),
    ])
    setCargando(false)
    if (c.error) { setError(c.error.message); return }
    setCtrl(c.data ?? []); setMeses(m.error ? [] : (m.data ?? [])); setAt(new Date())
  }, [])
  useEffect(() => { cargar() }, [cargar])

  const n = k => ctrl.filter(c => c.estado === k).length
  const vista = soloProblemas ? ctrl.filter(c => c.estado !== 'ok') : ctrl
  const areas = [...new Set(vista.map(c => c.area))]
  const veredicto = n('critico') > 0
    ? { c: ROJO, t: `${n('critico')} control(es) crítico(s): hay cifras que todavía no son definitivas` }
    : n('alerta') > 0
      ? { c: AMBAR, t: `Libros íntegros, con ${n('alerta')} punto(s) por mejorar` }
      : { c: VERDE, t: 'Todos los controles en verde: los números son confiables' }

  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 15px', borderBottom: `1px solid ${BORDE}`, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>Controles de integridad contable</div>
          <div style={{ fontSize: 11.5, color: SLATE, marginTop: 2 }}>
            Se recalculan sobre la contabilidad vigente cada vez que se abre esta pantalla{at ? ` · ${at.toLocaleTimeString('es-CL')}` : ''}
          </div>
        </div>
        {['ok', 'alerta', 'critico'].map(k => (
          <div key={k} style={{ fontSize: 12, fontWeight: 700, color: COLOR[k], padding: '4px 10px', border: `1px solid ${COLOR[k]}33`, borderRadius: 6, background: `${COLOR[k]}0D` }}>
            {n(k)} {ETIQ[k]}
          </div>
        ))}
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={soloProblemas} onChange={e => setSoloProblemas(e.target.checked)} /> Solo lo que falla
        </label>
        <button onClick={cargar} disabled={cargando} style={BTN}>{cargando ? 'Revisando…' : 'Actualizar'}</button>
        <button onClick={() => exportarExcel(ctrl, 'controles_integridad', 'Controles')} style={BTN}>Excel</button>
        <button onClick={() => exportarPDF({
          titulo: 'Controles de integridad contable', sub: veredicto.t,
          filas: ctrl.map(c => ({ Estado: ETIQ[c.estado], Área: c.area, Control: c.control, Detalle: c.detalle, Acción: c.estado === 'ok' ? '' : c.accion })),
        })} style={BTN}>PDF</button>
      </div>

      {error && <div style={{ margin: 12, background: '#FEF3F2', border: '1px solid #FECDCA', borderRadius: 6, padding: '9px 12px', color: ROJO, fontSize: 12.5 }}>{error}</div>}

      {ctrl.length > 0 && (
        <div style={{ margin: '12px 15px 0', borderLeft: `4px solid ${veredicto.c}`, background: '#FAFAFB', padding: '9px 12px', borderRadius: 4, fontSize: 13, fontWeight: 700, color: veredicto.c }}>
          {veredicto.t}
        </div>
      )}

      <div style={{ padding: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...TH, width: 86 }}>Estado</th><th style={TH}>Control</th><th style={TH}>Resultado</th><th style={TH}>Qué hacer</th>
          </tr></thead>
          <tbody>
            {areas.map(a => [
              <tr key={'h' + a}><td colSpan={4} style={{ ...TD, background: '#F7F7F8', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: SLATE, textTransform: 'uppercase' }}>{a}</td></tr>,
              ...vista.filter(c => c.area === a).map(c => (
                <tr key={c.orden}>
                  <td style={TD}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: COLOR[c.estado], border: `1px solid ${COLOR[c.estado]}55`, borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap' }}>{ETIQ[c.estado]}</span>
                  </td>
                  <td style={TD}>
                    <div style={{ fontWeight: 600, color: INK }}>{c.control}</div>
                    <div style={{ fontSize: 10.5, color: SLATE, marginTop: 1 }}>{c.estandar}</div>
                  </td>
                  <td style={{ ...TD, color: c.estado === 'ok' ? INK : COLOR[c.estado] }}>{c.detalle}</td>
                  <td style={{ ...TD, fontSize: 11.5, color: SLATE }}>{c.estado === 'ok' ? '—' : c.accion}</td>
                </tr>
              )),
            ])}
            {!vista.length && !cargando && <tr><td colSpan={4} style={{ ...TD, textAlign: 'center', color: VERDE, padding: 18 }}>Ningún control con problemas.</td></tr>}
          </tbody>
        </table>
      </div>

      {meses.length > 0 && (
        <div style={{ padding: '0 12px 12px', overflowX: 'auto' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY, margin: '4px 0 6px' }}>Estado de cada mes</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Mes</th><th style={TH}>Estado</th>
              <th style={{ ...TH, textAlign: 'right' }}>Resultado hoy</th>
              <th style={{ ...TH, textAlign: 'right' }}>Resultado congelado</th>
              <th style={{ ...TH, textAlign: 'right' }}>Diferencia</th>
              <th style={TH}>Qué falta para cerrarlo</th>
            </tr></thead>
            <tbody>
              {meses.map(m => {
                const cerrado = m.estado === 'cerrado'
                const deriva = cerrado && Math.abs(Number(m.diferencia || 0)) > 1
                return (
                  <tr key={m.periodo}>
                    <td style={{ ...TD, fontWeight: 600 }}>{m.periodo}</td>
                    <td style={TD}><span style={{ fontSize: 10, fontWeight: 700, color: cerrado ? VERDE : AMBAR }}>{cerrado ? 'CERRADO' : 'ABIERTO · provisional'}</span></td>
                    <td style={{ ...NUM, color: Number(m.resultado_actual) < 0 ? ROJO : INK }}>{fmt(m.resultado_actual)}</td>
                    <td style={NUM}>{cerrado ? fmt(m.resultado_congelado) : '—'}</td>
                    <td style={{ ...NUM, fontWeight: 700, color: deriva ? ROJO : SLATE }}>{cerrado ? (deriva ? fmt(m.diferencia) : '$0') : '—'}</td>
                    <td style={{ ...TD, fontSize: 11.5, color: cerrado ? SLATE : AMBAR }}>{cerrado ? `Cerrado por ${m.cerrado_por ?? '—'} · versión ${m.version ?? '—'}` : (m.pendientes_para_cerrar ?? '—')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ fontSize: 11, color: SLATE, marginTop: 6, lineHeight: 1.5 }}>
            Un mes cerrado no puede modificarse: sus asientos solo se corrigen con un contra-asiento y su resultado congelado debe coincidir siempre con el de hoy.
            Los meses abiertos son provisionales: no conviene informarlos a socios hasta cerrarlos.
          </div>
        </div>
      )}
    </div>
  )
}

export default ControlesIntegridad
