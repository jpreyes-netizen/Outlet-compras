// src/procesos/PrcHoy.jsx — la bandeja de trabajo diaria del módulo Procesos.
// Responde "¿qué me toca hoy?" a la persona conectada: sus comités de trabajo
// con el checklist del método P21, sus próximas sesiones (con convocatoria
// pendiente), sus acuerdos por vencer y lo que falta para dejar operativo el
// gobierno (reglamentos incompletos, comités sin próxima sesión, sesiones
// pasadas sin cerrar). Todo con un clic hacia la vista donde se resuelve.
//
// Tablas: v_prc_encargos · prc_encargo_pasos · prc_fases/prc_pasos (P21) ·
//         v_prc_sesiones · prc_asistencia_comite · v_prc_acuerdos

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../supabase'
import { Cd, Bt, Bd, Vacio, Barra, hoy, fFecha, puedeEditar } from './prcUI'
import { sumarDias } from './prcComite'

const norm = s => String(s || '').trim().toLowerCase()
const esMio = (nombre, cu) => norm(nombre) === norm(cu?.nombre)
const meIncluye = (lista, cu) => (lista || []).some(x => esMio(x, cu))

export function PrcHoy({ matriz, cat, cu, onAbrir, onIrComites, onIrConfig, toast }) {
  const editable = puedeEditar(cu)
  const [d, setD] = useState({ encargos: [], checks: [], mFases: [], mPasos: [], sesiones: [], asis: [], acuerdos: [] })
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    const [e, ck, mf, mp, s, a, ac] = await Promise.all([
      supabase.from('v_prc_encargos').select('*'),
      supabase.from('prc_encargo_pasos').select('encargo_id, paso_id, hecho'),
      supabase.from('prc_fases').select('id, orden, nombre').eq('proceso_id', 'P21').order('orden'),
      supabase.from('prc_pasos').select('id, fase_id, orden, accion, documento').eq('proceso_id', 'P21'),
      supabase.from('v_prc_sesiones').select('*').order('fecha'),
      supabase.from('prc_asistencia_comite').select('sesion_id, nombre'),
      supabase.from('v_prc_acuerdos').select('*')
    ])
    setD({
      encargos: e.data || [], checks: ck.error ? [] : (ck.data || []), mFases: mf.error ? [] : (mf.data || []),
      mPasos: mp.error ? [] : (mp.data || []), sesiones: s.data || [], asis: a.data || [], acuerdos: ac.error ? [] : (ac.data || [])
    })
    setLoading(false)
  }, [])
  useEffect(() => { cargar() }, [cargar])

  /* ── mis comités de trabajo (líder o integrante) ── */
  const misEncargos = useMemo(() => d.encargos
    .filter(e => ['ACTIVO', 'EN_PILOTO', 'EN_APROBACION'].includes(e.estado))
    .filter(e => esMio(e.lider, cu) || esMio(e.secretario, cu) || meIncluye(e.integrantes, cu))
    .sort((a, b) => (b.vencido ? 1 : 0) - (a.vencido ? 1 : 0) || (a.dias_restantes ?? 999) - (b.dias_restantes ?? 999)), [d.encargos, cu])

  const guiaDe = useCallback((enc) => {
    const f = d.mFases.find(x => x.orden === enc.fase_actual)
    if (!f) return null
    const pasos = d.mPasos.filter(x => x.fase_id === f.id).sort((a, b) => a.orden - b.orden)
    if (!pasos.length) return null
    const ok = new Set(d.checks.filter(c => c.encargo_id === enc.id && c.hecho).map(c => c.paso_id))
    const pend = pasos.filter(p => !ok.has(p.id))
    return { faseNombre: f.nombre, total: pasos.length, hechos: pasos.length - pend.length, siguiente: pend[0] || null }
  }, [d])

  /* ── sesiones: mis próximas (14 días) y las pasadas sin cerrar ── */
  const desde = hoy(), hasta = sumarDias(hoy(), 14)
  const comitesMios = useMemo(() => new Set((cat.comites || [])
    .filter(c => esMio(c.responsable, cu) || esMio(c.secretario, cu) || meIncluye(c.integrantes, cu)).map(c => c.codigo)), [cat, cu])
  const misSesiones = useMemo(() => {
    const convocadoEn = new Set(d.asis.filter(a => esMio(a.nombre, cu)).map(a => a.sesion_id))
    return d.sesiones
      .filter(s => s.estado !== 'ANULADA' && s.fecha >= desde && s.fecha <= hasta)
      .filter(s => comitesMios.has(s.comite_codigo) || convocadoEn.has(s.id))
      .slice(0, 6)
  }, [d.sesiones, d.asis, comitesMios, cu])   // eslint-disable-line
  const porCerrar = useMemo(() => d.sesiones.filter(s => s.estado === 'PLANIFICADA' && s.fecha < desde), [d.sesiones])   // eslint-disable-line

  /* ── mis acuerdos abiertos ── */
  const misAcuerdos = useMemo(() => d.acuerdos
    .filter(a => ['ABIERTO', 'EN_CURSO'].includes(a.estado) && esMio(a.responsable, cu))
    .sort((a, b) => (b.vencido ? 1 : 0) - (a.vencido ? 1 : 0) || String(a.fecha_compromiso || '9').localeCompare(String(b.fecha_compromiso || '9')))
    .slice(0, 8), [d.acuerdos, cu])

  /* ── setup pendiente del gobierno ── */
  const comitesIncompletos = useMemo(() => (cat.comites || [])
    .filter(c => (c.integrantes || []).length < 3 || !c.secretario), [cat])
  const sinProximaSesion = useMemo(() => (cat.comites || [])
    .filter(c => !d.sesiones.some(s => s.comite_codigo === c.codigo && s.fecha >= desde && s.estado !== 'ANULADA')), [cat, d.sesiones])   // eslint-disable-line
  const sinConvocar = useMemo(() => misSesiones.filter(s => !s.n_convocados && s.fecha <= sumarDias(hoy(), 4)), [misSesiones])

  const irEncargo = (id) => { try { localStorage.setItem('prc_enc_sel', id) } catch {} onIrComites('encargos') }
  const irSala = (id) => { try { localStorage.setItem('prc_sesion_sel', id) } catch {} onIrComites('sesion') }

  const nombreComite = k => ((cat.comites || []).find(c => c.codigo === k) || {}).nombre || k || '—'
  const nada = !loading && !misEncargos.length && !misSesiones.length && !misAcuerdos.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 19, fontWeight: 800 }}>Hola, {String(cu?.nombre || '').split(' ')[0] || 'equipo'} 👋</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })} · tu trabajo pendiente en el módulo Procesos
        </div>
      </div>

      {loading && <Cd><Vacio txt="Preparando tu día…" /></Cd>}

      {/* setup del gobierno: lo que impide operar */}
      {!loading && editable && (comitesIncompletos.length > 0 || sinConvocar.length > 0 || porCerrar.length > 0) && (
        <Cd accent="var(--warning)">
          <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 8 }}>🔧 Para dejar el gobierno operativo</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {comitesIncompletos.length > 0 && (
              <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
                <Bd c="var(--warning)">{comitesIncompletos.length}</Bd>
                <span style={{ flex: 1, minWidth: 220 }}>
                  Comité(s) con reglamento incompleto (sin secretario o con menos de 3 integrantes): sin eso no hay quórum ni actas.
                  <span style={{ color: 'var(--text-muted)' }}> {comitesIncompletos.slice(0, 4).map(c => c.codigo).join(' · ')}{comitesIncompletos.length > 4 ? '…' : ''}</span>
                </span>
                <Bt sm v="sec" onClick={onIrConfig}>Completar reglamentos →</Bt>
              </div>
            )}
            {sinConvocar.length > 0 && (
              <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
                <Bd c="var(--warning)">{sinConvocar.length}</Bd>
                <span style={{ flex: 1, minWidth: 220 }}>Sesión(es) en los próximos días sin nadie convocado (la convocatoria va con 48 h de anticipación).</span>
                <Bt sm v="sec" onClick={() => onIrComites('calendario')}>Convocar →</Bt>
              </div>
            )}
            {porCerrar.length > 0 && (
              <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 }}>
                <Bd c="var(--warning)">{porCerrar.length}</Bd>
                <span style={{ flex: 1, minWidth: 220 }}>Sesión(es) que ya pasaron y siguen planificadas: márcalas realizadas con sus acuerdos, o anúlalas.</span>
                <Bt sm v="sec" onClick={() => onIrComites('calendario')}>Cerrar sesiones →</Bt>
              </div>
            )}
          </div>
        </Cd>
      )}

      {/* mis comités de trabajo */}
      {!loading && misEncargos.length > 0 && (
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 800, margin: '2px 0 8px' }}>🧩 Tus comités de trabajo</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 11 }}>
            {misEncargos.map(e => {
              const g = guiaDe(e)
              const soyLider = esMio(e.lider, cu)
              return (
                <Cd key={e.id} accent={e.vencido ? 'var(--danger)' : 'var(--accent)'}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 12, color: 'var(--accent)' }}>{e.proceso_id}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.proceso_nombre}</span>
                    <Bd c={soyLider ? 'var(--accent)' : 'var(--text-muted)'}>{soyLider ? 'lideras' : esMio(e.secretario, cu) ? 'secretaría' : 'participas'}</Bd>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '5px 0 8px' }}>
                    Fase {e.fase_actual} · <b style={{ color: 'var(--text-secondary)' }}>{e.fase_actual_nombre}</b>
                    {' · '}
                    <span style={{ color: e.vencido ? 'var(--danger)' : e.dias_restantes <= 10 ? 'var(--warning)' : 'var(--text-muted)', fontWeight: 700 }}>
                      {e.vencido ? `vencido hace ${Math.abs(e.dias_restantes)} d` : `${e.dias_restantes} d de plazo`}
                    </span>
                  </div>
                  {g && (
                    <>
                      <Barra v={100 * g.hechos / g.total} label={`Método P21: ${g.hechos} de ${g.total} pasos de la fase`} c={g.hechos === g.total ? 'var(--success)' : 'var(--accent)'} />
                      {g.siguiente && (
                        <div style={{ fontSize: 12, margin: '7px 0 2px', padding: '7px 10px', borderRadius: 8, background: 'var(--bg-page)' }}>
                          <b>Siguiente paso:</b> {e.fase_actual}.{g.siguiente.orden} {g.siguiente.accion}
                          {g.siguiente.documento && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-muted)' }}>📄 entregable: {g.siguiente.documento}</span>}
                        </div>
                      )}
                    </>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
                    <Bt sm onClick={() => irEncargo(e.id)}>Trabajar en la fase →</Bt>
                    <Bt sm v="ghost" onClick={() => onAbrir(e.proceso_id)}>Ficha del proceso</Bt>
                  </div>
                </Cd>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
        {/* próximas sesiones */}
        {!loading && (
          <Cd>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 9 }}>
              <span style={{ fontSize: 13.5, fontWeight: 800 }}>📅 Tus próximas sesiones</span>
              <Bd c="var(--text-muted)">14 días</Bd>
              <Bt sm v="ghost" style={{ marginLeft: 'auto' }} onClick={() => onIrComites('calendario')}>Calendario →</Bt>
            </div>
            {misSesiones.length === 0 && <Vacio ic="🗓️" txt="Nada agendado en tus comités para los próximos 14 días. Desde el calendario puedes generar de una vez las sesiones del período según la periodicidad de cada comité." />}
            {misSesiones.map(s => (
              <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 9, background: 'var(--bg-page)', marginBottom: 6 }}>
                <div style={{ minWidth: 70, fontSize: 12, fontWeight: 800, color: s.fecha === hoy() ? 'var(--danger)' : 'var(--accent)' }}>
                  {s.fecha === hoy() ? 'HOY' : fFecha(s.fecha)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{nombreComite(s.comite_codigo)}{s.numero != null ? ` · N° ${s.numero}` : ''}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {s.hora_inicio || '—'}{s.lugar ? ' · ' + s.lugar : ''}
                    {!s.n_convocados ? ' · ⚠ sin convocar' : ` · ${s.n_convocados} convocados`}
                  </div>
                </div>
                <Bt sm v="sec" onClick={() => irSala(s.id)}>Abrir sala</Bt>
              </div>
            ))}
          </Cd>
        )}

        {/* mis acuerdos */}
        {!loading && (
          <Cd>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 9 }}>
              <span style={{ fontSize: 13.5, fontWeight: 800 }}>🤝 Tus acuerdos abiertos</span>
              {misAcuerdos.some(a => a.vencido) && <Bd c="var(--danger)">{misAcuerdos.filter(a => a.vencido).length} vencido(s)</Bd>}
              <Bt sm v="ghost" style={{ marginLeft: 'auto' }} onClick={() => onIrComites('agenda')}>Todos →</Bt>
            </div>
            {misAcuerdos.length === 0 && <Vacio ic="✅" txt="No tienes acuerdos abiertos a tu nombre. Los acuerdos nacen en la sala de sesión, con responsable, plazo y criterio de cierre." />}
            {misAcuerdos.map(a => (
              <div key={a.id} style={{ padding: '8px 10px', borderRadius: 9, background: 'var(--bg-page)', marginBottom: 6, borderLeft: `3px solid ${a.vencido ? 'var(--danger)' : 'var(--warning)'}` }}>
                <div style={{ fontSize: 12.3, lineHeight: 1.4 }}>{a.acuerdo}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  {a.comite_codigo}{a.proceso_id ? ` · ${a.proceso_id}` : ''} · compromiso {fFecha(a.fecha_compromiso)}
                  {a.vencido && <b style={{ color: 'var(--danger)' }}> · {a.dias_atraso} d de atraso</b>}
                </div>
              </div>
            ))}
          </Cd>
        )}
      </div>

      {/* sin nada personal: guía de partida */}
      {nada && (
        <Cd>
          <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 6 }}>Todo al día por tu lado 🎉 — para poner el sistema en marcha:</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
            {[
              ['1 · Completa los reglamentos', 'Integrantes (impar ≥ 3), secretario y periodicidad de cada comité.', 'Config → Comités', onIrConfig],
              ['2 · Genera el calendario', 'Las sesiones del período de cada comité, de una sola vez.', 'Comités → Calendario', () => onIrComites('calendario')],
              ['3 · Encarga procesos', 'Cada proceso de la Onda 1 a un comité de trabajo con líder y plazo de 2 meses.', 'Comités → Comités de trabajo', () => onIrComites('encargos')]
            ].map(([t, d2, ruta, fn]) => (
              <div key={t} onClick={fn} style={{ padding: 12, borderRadius: 11, background: 'var(--bg-page)', cursor: 'pointer' }}>
                <div style={{ fontSize: 12.5, fontWeight: 800 }}>{t}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 6px', lineHeight: 1.5 }}>{d2}</div>
                <div style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 700 }}>{ruta} →</div>
              </div>
            ))}
          </div>
        </Cd>
      )}

      {/* comités sin próxima sesión (aviso suave al pie) */}
      {!loading && editable && sinProximaSesion.length > 0 && misEncargos.length + misSesiones.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '2px 4px' }}>
          📅 Sin próxima sesión agendada: {sinProximaSesion.map(c => c.codigo).join(' · ')} —{' '}
          <span onClick={() => onIrComites('calendario')} style={{ color: 'var(--accent)', fontWeight: 700, cursor: 'pointer' }}>generar calendario</span>
        </div>
      )}
    </div>
  )
}
