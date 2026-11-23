import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabase'
import {
  SEM, EJE, FRANJA, APP_NOMBRE, btnP, btnS, panelCaja,
  fmtValor, fmtMeta, fechaLarga, horaCL, nivel, medirIndicador,
  Chip, ChipSit, Historia, AsignarAccion, ConfigIndicador
} from './cgComun'

/* ═══ Ficha del indicador ═══
   Responde "qué está pasando y por qué": diagnóstico con cifras, desglose por
   sucursal / proveedor / persona / SKU según el indicador, qué hacer y a quién
   asignarlo, historia, acciones en curso y cómo se mide.
   El análisis lo calcula el motor (cg_desglose) junto a la medición. */

const titSec = { fontSize: 13, fontWeight: 700, color: '#1C1C1E' }
const ESC_NEG = '#F8B4AE'
const ESC_POS = '#CBD5E1'

function celda(v, u) {
  if (v === null || v === undefined || v === '') return '—'
  if (u === 'fecha') return fechaLarga(v)
  if (u && ['$', '%', 'n', 'min', 'días', 'ratio'].includes(u)) return fmtValor(v, u)
  return String(v)
}

export function TablaSeccion({ sec }) {
  const [todas, setTodas] = useState(false)
  const filas = Array.isArray(sec.filas) ? sec.filas : []
  const cols = (Array.isArray(sec.columnas) && sec.columnas.length)
    ? sec.columnas
    : Object.keys(filas[0] || {}).map(k => ({ k, l: k }))
  const maximos = {}
  for (const c of cols) if (c.barra) maximos[c.k] = Math.max(0, ...filas.map(f => Math.abs(Number(f[c.k]) || 0)))
  const visibles = todas ? filas : filas.slice(0, 10)
  const numerica = c => c.u && c.u !== 'fecha'

  return (
    <section style={{ ...panelCaja, padding: '10px 12px' }} aria-label={sec.titulo}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span style={titSec}>{sec.titulo}</span>
        <span style={{ fontSize: 11.5, color: '#6B7280' }}>{filas.length} {filas.length === 1 ? 'fila' : 'filas'}</span>
      </div>
      {filas.length === 0
        ? <div style={{ fontSize: 12, color: '#9CA3AF', padding: '4px 0' }}>Sin registros.</div>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr>
                  {cols.map(c => (
                    <th key={c.k} style={{
                      textAlign: numerica(c) ? 'right' : 'left', padding: '5px 8px', fontSize: 11, fontWeight: 600, color: '#6B7280',
                      borderBottom: '1px solid #E5E7EB', whiteSpace: 'nowrap'
                    }}>{c.l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibles.map((f, i) => (
                  <tr key={i} style={{ borderTop: i ? '1px solid #F1F5F9' : 'none' }}>
                    {cols.map(c => {
                      const v = f[c.k]
                      const txt = celda(v, c.u)
                      if (c.barra && maximos[c.k] > 0 && Number.isFinite(Number(v))) {
                        const n = Number(v)
                        return (
                          <td key={c.k} style={{ padding: '4px 8px', textAlign: 'right', minWidth: 120 }}>
                            <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                              <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 3, bottom: 3, width: `${(100 * Math.abs(n)) / maximos[c.k]}%`, background: n < 0 ? ESC_NEG : ESC_POS, borderRadius: 3 }} />
                              <span style={{ position: 'relative', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: '#1C1C1E' }}>{txt}</span>
                            </div>
                          </td>
                        )
                      }
                      return (
                        <td key={c.k} style={{
                          padding: '5px 8px', textAlign: numerica(c) ? 'right' : 'left', color: '#1F2937',
                          fontVariantNumeric: numerica(c) ? 'tabular-nums' : 'normal',
                          maxWidth: numerica(c) ? undefined : 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                        }} title={numerica(c) ? undefined : txt}>{txt}</td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {filas.length > 10 && (
        <button onClick={() => setTodas(t => !t)} style={{ ...btnS, marginTop: 6, padding: '3px 9px', fontSize: 11.5 }}>
          {todas ? 'Ver solo 10' : `Ver las ${filas.length} filas`}
        </button>
      )}
      {sec.nota && <div style={{ fontSize: 11.5, color: '#6B7280', marginTop: 6, lineHeight: 1.45 }}>{sec.nota}</div>}
    </section>
  )
}

export function CgFicha({ codigo, datos, isMobile, onCerrar, irA, abrirApp }) {
  const { cat, ult, hist, dimNom, prioridades, acciones, usuarios, recargar } = datos
  const ind = cat[codigo]
  const u = ult.find(r => r.codigo === codigo)
  const prio = prioridades.find(p => p.codigo === codigo)
  const misAcciones = acciones.filter(a => a.indicador === codigo)
  const dueno = usuarios.find(x => x.id === ind?.responsable_id)?.nombre
  const [des, setDes] = useState(null)
  const [cargandoDes, setCargandoDes] = useState(true)
  const [actualizando, setActualizando] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [asignar, setAsignar] = useState(false)

  const cargarDes = useCallback(async () => {
    setCargandoDes(true)
    const { data, error } = await supabase.from('cg_desglose').select('*').eq('indicador', codigo).maybeSingle()
    setDes(error ? { desglose: { error: error.message } } : data)
    setCargandoDes(false)
  }, [codigo])

  useEffect(() => { cargarDes() }, [cargarDes])
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !asignar) onCerrar?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [asignar, onCerrar])

  if (!ind) return null
  const diaria = ind.franja === 'diaria'
  const metaDinamica = ind.meta == null && ind.tolerancia_pct != null
  const d = des?.desglose || null
  const nv = prio ? nivel(prio.prioridad) : null

  const actualizar = async () => {
    setActualizando(true); setAviso(null)
    try {
      const r = await medirIndicador(codigo, true)
      if (r?.err) setAviso({ tipo: 'error', txt: 'La medición falló: ' + r.err })
      await Promise.all([cargarDes(), recargar()])
      if (!r?.err) setAviso({ tipo: 'ok', txt: 'Análisis actualizado.' })
    } catch (e) {
      const m = String(e?.message || e)
      setAviso({ tipo: 'error', txt: /timeout|cancel/i.test(m)
        ? 'Este análisis es pesado para calcularlo desde la pantalla: se actualiza solo en la medición automática.'
        : 'No se pudo actualizar: ' + m })
    } finally { setActualizando(false) }
  }

  const col2 = isMobile ? '1fr' : 'minmax(0,1.6fr) minmax(300px,1fr)'

  return (
    <div role="dialog" aria-modal="true" aria-label={`Ficha de ${ind.nombre}`} style={{
      position: 'fixed', inset: 0, zIndex: 250, background: '#F2F2F7', overflowY: 'auto',
      fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif"
    }}>
      {/* Barra superior */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'rgba(242,242,247,0.95)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        <div style={{ maxWidth: 1600, margin: '0 auto', padding: isMobile ? '8px 10px' : '8px 20px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={onCerrar} style={btnS}>← Volver</button>
          <span style={{ fontSize: 12, color: '#6B7280' }}>{dimNom[ind.dimension] || ind.dimension} › {EJE[ind.eje] || ind.eje} › {ind.codigo}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => setAsignar(true)} style={btnP}>Asignar acción</button>
          {ind.app_destino && APP_NOMBRE[ind.app_destino] && abrirApp && <button onClick={() => abrirApp(ind.app_destino)} style={btnS}>Abrir {APP_NOMBRE[ind.app_destino]}</button>}
        </div>
      </div>

      <div style={{ maxWidth: 1600, margin: '0 auto', padding: isMobile ? '12px 10px 32px' : '14px 20px 40px' }}>
        {/* Encabezado */}
        <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 800, color: '#1C1C1E', letterSpacing: '-0.01em', lineHeight: 1.25 }}>{ind.nombre}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
          <span style={{ fontSize: isMobile ? 26 : 32, fontWeight: 800, color: '#1C1C1E', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtValor(u?.valor, ind.unidad, true)}</span>
          <Chip s={u?.semaforo} />
          {nv && <span style={{ fontSize: 12, fontWeight: 700, color: nv.c }}>{nv.l}, puntaje {prio.prioridad}</span>}
          <span style={{ fontSize: 12.5, color: '#374151' }}>
            Meta {fmtMeta(u?.meta ?? ind.meta, ind.sentido, ind.unidad) || 'por definir'}{metaDinamica && ' (dinámica, del presupuesto)'}
            {u?.umbral_rojo != null && <>; rojo desde {fmtValor(u.umbral_rojo, ind.unidad)}</>}
          </span>
          <span style={{ fontSize: 12, color: '#6B7280' }}>Medido {horaCL(u?.medido_at)}</span>
        </div>
        {u?.error && <div style={{ marginTop: 8, fontSize: 12.5, color: SEM.error.c, background: SEM.error.bg, padding: '6px 10px', borderRadius: 6 }}>Error de medición: {u.error}</div>}

        {/* Qué está pasando + Qué hacer */}
        <div style={{ display: 'grid', gridTemplateColumns: col2, gap: 10, marginTop: 12, alignItems: 'start' }}>
          <section aria-label="Qué está pasando" style={{ ...panelCaja, padding: '12px 14px', borderLeft: `4px solid ${(SEM[u?.semaforo] || SEM.sin_dato).c}` }}>
            <div style={titSec}>Qué está pasando</div>
            {cargandoDes
              ? <div style={{ fontSize: 13, color: '#9CA3AF', marginTop: 6 }}>Cargando el análisis…</div>
              : d?.error
                ? <div style={{ fontSize: 13, color: SEM.error.c, marginTop: 6 }}>No se pudo calcular el análisis: {d.error}</div>
                : d?.diagnostico
                  ? <div style={{ fontSize: 14, color: '#111827', marginTop: 6, lineHeight: 1.55 }}>{d.diagnostico}</div>
                  : <div style={{ fontSize: 13, color: '#4B5563', marginTop: 6, lineHeight: 1.5 }}>Todavía no hay análisis para este indicador. Se calcula en la medición automática{diaria ? ', o puedes calcularlo ahora.' : ' de las 03:30.'}</div>}
            {u?.detalle && <div style={{ fontSize: 12.5, color: '#4B5563', marginTop: 8, lineHeight: 1.5 }}>Medición: {u.detalle}</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, color: '#6B7280' }}>{des?.calculado_at ? `Análisis calculado el ${horaCL(des.calculado_at)}.` : ''}</span>
              {diaria && <button onClick={actualizar} disabled={actualizando} style={{ ...btnS, padding: '3px 9px', fontSize: 11.5, opacity: actualizando ? 0.6 : 1 }}>{actualizando ? 'Calculando…' : 'Actualizar análisis'}</button>}
            </div>
            {aviso && <div role="status" style={{ marginTop: 8, fontSize: 12, padding: '6px 8px', borderRadius: 6, color: aviso.tipo === 'ok' ? SEM.verde.c : SEM.rojo.c, background: aviso.tipo === 'ok' ? SEM.verde.bg : SEM.rojo.bg }}>{aviso.txt}</div>}
          </section>

          <section aria-label="Qué hacer" style={{ ...panelCaja, padding: '12px 14px' }}>
            <div style={titSec}>Qué hacer</div>
            {ind.por_que && <div style={{ fontSize: 12.5, color: '#1F2937', marginTop: 6, lineHeight: 1.5 }}><b>Por qué importa.</b> {ind.por_que}</div>}
            {ind.accion_sugerida && <div style={{ fontSize: 12.5, color: '#1F2937', marginTop: 4, lineHeight: 1.5 }}><b>Primer paso.</b> {ind.accion_sugerida}</div>}
            <div style={{ fontSize: 12.5, color: '#4B5563', marginTop: 4 }}><b>Dueño sugerido.</b> {dueno || 'por asignar'}</div>
            <div style={{ marginTop: 10 }}><button onClick={() => setAsignar(true)} style={btnP}>Asignar acción</button></div>
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #F1F5F9' }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>Acciones sobre este indicador</div>
              {misAcciones.length === 0
                ? <div style={{ fontSize: 12, color: '#9CA3AF' }}>Ninguna todavía.</div>
                : misAcciones.map(a => (
                  <button key={a.tarea_id} onClick={() => { onCerrar?.(); irA?.('acciones', { sel: a.tarea_id, filtro: 'todas' }) }} style={{
                    display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: '1px solid #EEF0F3', borderRadius: 6, padding: '6px 8px', marginBottom: 4, cursor: 'pointer', fontFamily: 'inherit'
                  }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#1C1C1E' }}>{a.titulo}</span>
                      <ChipSit s={a.situacion} />
                    </span>
                    <span style={{ display: 'block', fontSize: 11, color: '#6B7280', marginTop: 2 }}>{a.responsable || 'sin responsable'}, vence {fechaLarga(a.fecha_vencimiento)}</span>
                  </button>
                ))}
            </div>
          </section>
        </div>

        {/* Desglose */}
        {Array.isArray(d?.secciones) && d.secciones.length > 0 && (
          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            {d.secciones.map((sec, i) => <TablaSeccion key={i} sec={sec} />)}
          </div>
        )}

        {/* Historia + cómo se mide */}
        <div style={{ display: 'grid', gridTemplateColumns: col2, gap: 10, marginTop: 10, alignItems: 'start' }}>
          <section aria-label="Historia" style={{ ...panelCaja, padding: '10px 12px' }}>
            <div style={{ ...titSec, marginBottom: 6 }}>Historia, últimos 60 días</div>
            <Historia pts={hist[codigo] || []} unidad={ind.unidad} />
            {(hist[codigo] || []).length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 6 }}>
                <tbody>
                  {(hist[codigo] || []).slice(-8).reverse().map(m => (
                    <tr key={m.fecha_medicion} style={{ borderTop: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '4px 0', color: '#6B7280' }}>{fechaLarga(m.fecha_medicion)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtValor(m.valor, ind.unidad)}</td>
                      <td style={{ padding: '4px 0', textAlign: 'right' }}><Chip s={m.semaforo} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section aria-label="Cómo se mide" style={{ ...panelCaja, padding: '10px 12px', fontSize: 12.5, color: '#374151', lineHeight: 1.6 }}>
            <div style={{ ...titSec, marginBottom: 4 }}>Cómo se mide</div>
            <div><b>Fuente:</b> {ind.fuente}</div>
            <div><b>Pantalla donde se cuadra:</b> {ind.pantalla || 'sin registrar'}</div>
            <div><b>Medición:</b> {FRANJA[ind.franja] || ind.franja}</div>
            {ind.nota && <div><b>Nota:</b> {ind.nota}</div>}
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>SQL del valor</summary>
              <pre style={{ fontSize: 10.5, background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 6, padding: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#334155' }}>{ind.sql_medicion}</pre>
            </details>
            {ind.sql_desglose && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>SQL del análisis</summary>
                <pre style={{ fontSize: 10.5, background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 6, padding: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#334155' }}>{ind.sql_desglose}</pre>
              </details>
            )}
          </section>
        </div>

        {/* Configuración */}
        <details style={{ ...panelCaja, padding: '10px 12px', marginTop: 10 }}>
          <summary style={{ ...titSec, cursor: 'pointer' }}>Configurar meta, umbrales, dueño e importancia</summary>
          <div style={{ marginTop: 10 }}>
            <ConfigIndicador ind={ind} usuarios={usuarios} onGuardado={async () => { await Promise.all([recargar(), cargarDes()]) }} />
          </div>
        </details>
      </div>

      {asignar && (
        <AsignarAccion ind={ind} u={u} prioridad={prio?.prioridad} usuarios={usuarios}
          onCerrar={() => setAsignar(false)}
          onCreada={async () => { setAsignar(false); setAviso({ tipo: 'ok', txt: 'Acción creada y enviada al responsable.' }); await recargar() }} />
      )}
    </div>
  )
}
