// src/procesos/PrcFicha.jsx — ficha completa de un proceso
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabase'
import {
  Cd, Bt, Bd, Mt, Barra, Sheet, Tabs, Vacio, Criterios, css, pct, hoy, fFecha,
  SEMAFORO, puedeEditar, puedeAprobar, uid, Ayuda, Hint
} from './prcUI'
import { PrcSOP } from './PrcSOP'
import { PrcFlujograma } from './PrcFlujograma'
import { PrcEditor } from './PrcEditor'
import { etapas, CicloVida, SiguientePaso, desgloseAvance, PESOS_AVANCE } from './PrcGuia'
import { generarInformeProceso } from './prcInformeProceso'

const SUB = [
  { k: 'resumen',  l: 'Resumen',      ic: '📌' },
  { k: 'editar',   l: 'Editar',       ic: '✏️' },
  { k: 'sop',      l: 'SOP',          ic: '📄' },
  { k: 'flujo',    l: 'Flujograma',   ic: '🗺️' },
  { k: 'avance',   l: 'Avance',       ic: '📈' },
  { k: 'docs',     l: 'Documentos',   ic: '📁' },
  { k: 'capac',    l: 'Capacitación', ic: '🎓' },
  { k: 'kpi',      l: 'KPI',          ic: '🎯' },
  { k: 'bitacora', l: 'Bitácora',     ic: '🕘' }
]

export function PrcFicha({ id, cu, cat, matriz, deps, onCerrar, onRefrescarMatriz, onAbrir, toast }) {
  // Refresca los datos SIN cerrar la ficha: guardar no debe sacarte de acá.
  // cargar() ya está inicializada cuando esto se invoca (nunca corre en el render inicial).
  const refrescar = () => { cargar(true); if (typeof onRefrescarMatriz === 'function') onRefrescarMatriz() }
  const [sub, setSub] = useState('resumen')
  const [d, setD] = useState(null)
  const [encargo, setEncargo] = useState(null)
  const [generandoInf, setGenerandoInf] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState(null)      // 'avance' | 'capac' | 'medicion' | 'hito'
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)

  const p = matriz.find(x => x.id === id)

  // silencioso: refresca sin mostrar "Cargando ficha…", que desmonta el editor
  // y se lleva lo que estabas escribiendo. Guardar una sección usa este modo.
  const cargar = useCallback(async (silencioso) => {
    if (!silencioso) setLoading(true)
    const [pr, ro, tr, fa, pa, er, kp, dc, fi, av, ca, me, hi] = await Promise.all([
      supabase.from('prc_principios').select('*').eq('proceso_id', id).order('orden'),
      supabase.from('prc_roles').select('*').eq('proceso_id', id).order('orden'),
      supabase.from('prc_transicion').select('*').eq('proceso_id', id).order('orden'),
      supabase.from('prc_fases').select('*').eq('proceso_id', id).order('orden'),
      supabase.from('prc_pasos').select('*').eq('proceso_id', id).order('orden'),
      supabase.from('prc_errores').select('*').eq('proceso_id', id).order('orden'),
      supabase.from('prc_kpis').select('*').eq('proceso_id', id).order('orden'),
      supabase.from('prc_documentos').select('*').eq('proceso_id', id),
      supabase.from('prc_firmas').select('*').eq('proceso_id', id),
      supabase.from('prc_avance').select('*').eq('proceso_id', id).order('fecha_corte', { ascending: false }),
      supabase.from('prc_capacitaciones').select('*').eq('proceso_id', id).order('fecha', { ascending: false }),
      supabase.from('prc_mediciones').select('*').eq('proceso_id', id).order('periodo', { ascending: false }),
      supabase.from('prc_hitos').select('*').eq('proceso_id', id).order('fecha', { ascending: false })
    ])
    // comité de trabajo activo (P21); si la vista no existe todavía, se ignora
    const en = await supabase.from('v_prc_encargos').select('*').eq('proceso_id', id).in('estado', ['ACTIVO', 'EN_PILOTO', 'EN_APROBACION'])
    setEncargo(en.error ? null : ((en.data || [])[0] || null))
    setD({
      principios: pr.data || [], roles: ro.data || [], transicion: tr.data || [],
      fases: fa.data || [], pasos: pa.data || [], errores: er.data || [], kpis: kp.data || [],
      docs: dc.data || [], firmas: fi.data || [], avance: av.data || [],
      capac: ca.data || [], mediciones: me.data || [], hitos: hi.data || []
    })
    if (!silencioso) setLoading(false)
  }, [id])

  useEffect(() => { cargar() }, [cargar])

  const pasosCiclo = useMemo(() => etapas({ proceso: p, d }), [p, d])

  const misDeps = useMemo(() => deps.filter(x => x.proceso_id === id), [deps, id])
  const meRequieren = useMemo(() => deps.filter(x => x.depende_de_id === id), [deps, id])
  const editable = puedeEditar(cu)

  if (!p) return <Cd><Vacio txt="Proceso no encontrado" /></Cd>
  const s = SEMAFORO[p.semaforo] || SEMAFORO.gris
  const catg = cat.categorias.find(c => c.codigo === p.categoria) || {}
  const comite = cat.comites.find(c => c.codigo === p.comite_codigo)

  /* ── guardados ───────────────────────────────────────────────────────────── */
  const guardarAvance = async () => {
    if (!form.comentario?.trim()) return toast('La nota es obligatoria: qué avanzó y qué bloquea el siguiente paso.', 'err')
    setBusy(true)
    const fecha = form.fecha_corte || hoy()
    const a = desgloseAvance({ proceso: p, d })
    const { error } = await supabase.from('prc_avance').upsert({
      id: `${id}-AV-${fecha.replace(/-/g, '')}`, proceso_id: id, fecha_corte: fecha,
      pct_flujograma: a.flujograma, pct_sop: a.sop, pct_capacitacion: a.capacitacion, pct_implementacion: a.implementacion,
      comentario: form.comentario.trim(), registrado_por: cu?.nombre || '—'
    })
    setBusy(false)
    if (error) return toast('Error al guardar la nota: ' + error.message, 'err')
    setSheet(null); toast('Nota de avance registrada'); refrescar()
  }

  const guardarCapac = async () => {
    if (!form.asistentes?.trim()) return toast('Registra al menos un asistente: la evidencia es requisito del criterio de implementación.', 'err')
    const lista = form.asistentes.split(/[\n,;]+/).map(x => x.trim()).filter(Boolean)
    setBusy(true)
    const { error } = await supabase.from('prc_capacitaciones').insert({
      id: uid(), proceso_id: id, fecha: form.fecha || hoy(), sucursal: form.sucursal || null,
      facilitador: form.facilitador || cu?.nombre, asistentes: lista, n_asistentes: lista.length,
      duracion_min: form.duracion ? +form.duracion : null, evidencia_url: form.evidencia || null,
      evaluacion_aplicada: !!form.evaluacion
    })
    setBusy(false)
    if (error) return toast('Error al registrar la capacitación: ' + error.message, 'err')
    setSheet(null); toast(`Capacitación registrada con ${lista.length} asistentes`); refrescar()
  }

  const guardarMedicion = async () => {
    if (!form.periodo?.trim()) return toast('Indica el período de la medición (por ejemplo 2026-08).', 'err')
    setBusy(true)
    const { error } = await supabase.from('prc_mediciones').insert({
      id: uid(), kpi_id: form.kpi_id || null, proceso_id: id, periodo: form.periodo.trim(),
      valor: form.valor === '' || form.valor == null ? null : +form.valor,
      valor_texto: form.valor_texto || null, meta_periodo: form.meta || null,
      cumple: form.cumple === 'si' ? true : form.cumple === 'no' ? false : null,
      comentario: form.comentario || null, registrado_por: cu?.nombre || '—'
    })
    setBusy(false)
    if (error) return toast('Error al registrar la medición: ' + error.message, 'err')
    setSheet(null); toast('Medición registrada'); refrescar()
  }

  const guardarHito = async () => {
    if (!form.descripcion?.trim()) return toast('Describe el hito.', 'err')
    setBusy(true)
    const { error } = await supabase.from('prc_hitos').insert({
      id: uid(), proceso_id: id, fecha: form.fecha || hoy(), tipo: form.tipo || 'REVISION',
      descripcion: form.descripcion.trim(), responsable: cu?.nombre || '—', evidencia_url: form.evidencia || null
    })
    setBusy(false)
    if (error) return toast('Error al registrar el hito: ' + error.message, 'err')
    setSheet(null); toast('Hito registrado'); refrescar()
  }

  const archivar = async () => {
    setBusy(true)
    const { error } = await supabase.from('prc_procesos').update({ activo: false }).eq('id', id)
    if (!error) {
      await supabase.from('prc_hitos').insert({
        id: uid(), proceso_id: id, fecha: hoy(), tipo: 'REVISION',
        descripcion: 'Proceso archivado: sale de la matriz y de los indicadores. Reactivable desde Matriz → Archivados.',
        responsable: cu?.nombre || '—'
      })
    }
    setBusy(false)
    if (error) return toast('No se pudo archivar: ' + error.message, 'err')
    setSheet(null)
    toast(`${id} archivado. Lo encuentras en Matriz → Archivados.`)
    onCerrar(true)
  }

  const informeProceso = async () => {
    setGenerandoInf(true)
    try { await generarInformeProceso({ p, d, cat, matriz, deps, encargo, cu, toast }) }
    catch (e) { toast('No se pudo generar el informe: ' + (e?.message || e), 'err') }
    setGenerandoInf(false)
  }

  const abrirAvance = () => {
    setForm({ fecha_corte: hoy(), comentario: '' })
    setSheet('avance')
  }


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── cabecera ── */}
      <Cd style={{ borderLeft: `4px solid ${s.c}` }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Bt v="sec" sm onClick={() => onCerrar(false)}>← Matriz</Bt>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 5 }}>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 15 }}>{p.id}</span>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{p.nombre}</span>
              <Bd c={catg.color}>{catg.nombre || p.categoria}</Bd>
              <Bd c="var(--text-muted)">{String(p.onda || '').replace('ONDA_', 'Onda ')}</Bd>
              <Bd c={p.score === 9 ? 'var(--danger)' : p.score >= 6 ? 'var(--warning)' : 'var(--text-muted)'}>score {p.score}</Bd>
              <Bd c={s.c}>{s.l}</Bd>
              {p.nivel_detalle && <Bd c="var(--text-muted)">detalle {p.nivel_detalle}</Bd>}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span>Dueño: <b style={{ color: 'var(--text-secondary)' }}>{p.dueno_persona || p.dueno_cargo || '—'}</b>{p.dueno_provisional && ' (provisional)'}</span>
              <span>Dirección: {p.direccion_etiqueta || p.direccion_responsable}</span>
              <span>Comité: {comite?.nombre || '—'}</span>
              <span>Objetivo vigente: {fFecha(p.fecha_objetivo_vigente)}{p.dias_atraso > 0 ? ` · ${p.dias_atraso} d de atraso` : ''}</span>
            </div>
          </div>
          <div style={{ minWidth: 210 }}>
            <Barra v={p.pct_global} c={s.c} label={`Avance global · ${p.estado_impl_etiqueta || p.estado_implementacion}`} h={9} />
            <div style={{ marginTop: 9 }}><Criterios p={p} /></div>
            <div style={{ marginTop: 9, display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Bt sm dis={!d || generandoInf} onClick={informeProceso}
                title="Informe completo del proceso: avance y etapas, contenido del SOP, flujograma anexado con documentos y responsables, indicadores, versiones, firmas, comité de trabajo, acuerdos, decisiones y bitácora. Se abre en una pestaña nueva: Imprimir → Guardar como PDF.">
                📄 {generandoInf ? 'Generando…' : 'Informe del proceso'}
              </Bt>
              {puedeAprobar(cu) && (
                <Bt v="ghost" sm onClick={() => setSheet('archivar')}
                  title="Saca el proceso de la matriz sin borrar su historia. Se puede reactivar desde Matriz → Archivados.">
                  🗂️ Archivar proceso
                </Bt>
              )}
            </div>
          </div>
        </div>
        {p.regla_critica && (
          <div style={{
            marginTop: 12, padding: '10px 14px', borderRadius: 10, background: 'var(--danger-bg)',
            borderLeft: '3px solid var(--danger)', fontSize: 12.5, color: 'var(--danger-text)'
          }}>
            <b>REGLA CRÍTICA · </b>{p.regla_critica}
          </div>
        )}
      </Cd>

      {/* ── guía: en qué etapa va y qué sigue ── */}
      {!loading && d && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SiguientePaso pasos={pasosCiclo} onIr={setSub}
            implementado={p.estado_implementacion === 'IMPLEMENTADO'} />
          <CicloVida pasos={pasosCiclo} onIr={setSub} />
          {encargo && (
            <div style={{
              display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '9px 13px', borderRadius: 10,
              background: 'var(--bg-surface)', border: '1px solid var(--border-1)', borderLeft: `3px solid ${encargo.vencido ? 'var(--danger)' : 'var(--accent)'}`, fontSize: 12.5
            }}>
              <span>🧩</span>
              <span><b>Comité de trabajo</b> liderado por <b>{encargo.lider}</b> · {(encargo.integrantes || []).length} integrantes · fase {encargo.fase_actual} de 7 ({encargo.fase_actual_nombre})</span>
              <Bd c={encargo.vencido ? 'var(--danger)' : encargo.dias_restantes <= 10 ? 'var(--warning)' : 'var(--text-muted)'}>
                {encargo.vencido ? `plazo vencido hace ${Math.abs(encargo.dias_restantes)} d` : `${encargo.dias_restantes} días de plazo`}
              </Bd>
              <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>Se gestiona en Comités → Comités de trabajo (P21).</span>
            </div>
          )}
        </div>
      )}

      <Tabs sm tabs={SUB.map(t => ({
        ...t,
        n: t.k === 'docs' ? d?.docs?.length : t.k === 'kpi' ? d?.kpis?.length
          : t.k === 'capac' ? d?.capac?.length : t.k === 'bitacora' ? d?.hitos?.length : undefined
      }))} val={sub} onChange={setSub} />

      {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Cargando ficha…</div>}

      {!loading && d && sub === 'resumen' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <Ayuda k="resumen" titulo="Qué estás viendo acá">
            El contenido del proceso en modo lectura: objetivo, principios, roles con sus límites, el diagnóstico de
            transición y las dependencias con otros procesos. Para cambiar cualquier cosa de esta pantalla, usa la
            pestaña <b>Editar</b>. Los procesos con los que este se relaciona son clickeables: te llevan a su ficha.
          </Ayuda>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 13 }}>
            <Cd>
              <H>Objetivo</H><P>{p.objetivo || '—'}</P>
              <H style={{ marginTop: 14 }}>Alcance</H><P>{p.alcance || '—'}</P>
              {p.observaciones && (<><H style={{ marginTop: 14 }}>Observaciones del levantamiento</H><P>{p.observaciones}</P></>)}
            </Cd>
            <Cd>
              <H>Principios operativos</H>
              {d.principios.length === 0 && <P style={{ color: 'var(--text-muted)' }}>Sin principios registrados.</P>}
              <ul style={{ margin: '6px 0 0 16px', fontSize: 12.5, lineHeight: 1.65 }}>
                {d.principios.map(x => <li key={x.id}>{x.texto}</li>)}
              </ul>
              <H style={{ marginTop: 14 }}>Sistemas</H>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                {(p.sistemas || []).map(s2 => {
                  const sis = cat.sistemas.find(x => x.codigo === s2)
                  return <Bd key={s2} c={sis?.color || 'var(--text-muted)'}>{sis?.etiqueta || s2}</Bd>
                })}
                {(!p.sistemas || !p.sistemas.length) && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>}
              </div>
            </Cd>
          </div>

          <Cd>
            <H>Roles y límites</H>
            {d.roles.length === 0 ? <P style={{ color: 'var(--text-muted)' }}>Sin roles registrados.</P> : (
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={{ ...css.th, width: 190 }}>Rol</th>
                    <th style={css.th}>Función en este proceso</th>
                    <th style={css.th}>Límite — qué NO puede hacer</th>
                  </tr></thead>
                  <tbody>{d.roles.map(r => (
                    <tr key={r.id}>
                      <td style={{ ...css.td, fontWeight: 700 }}>{r.rol}</td>
                      <td style={css.td}>{r.funcion}</td>
                      <td style={{ ...css.td, color: 'var(--danger-text)' }}>{r.limite}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Cd>

          <Cd>
            <H>Estado de transición · hoy vs. cómo debe funcionar</H>
            {d.transicion.length === 0 ? <P style={{ color: 'var(--text-muted)' }}>Sin diagnóstico registrado.</P> : (
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={{ ...css.th, width: 150 }}>Dimensión</th>
                    <th style={css.th}>Hoy</th>
                    <th style={css.th}>Debe funcionar así</th>
                  </tr></thead>
                  <tbody>{d.transicion.map(t => (
                    <tr key={t.id}>
                      <td style={{ ...css.td, fontWeight: 700 }}>{t.dimension}</td>
                      <td style={{ ...css.td, color: 'var(--text-muted)' }}>{t.hoy}</td>
                      <td style={{ ...css.td, color: 'var(--success-text)' }}>{t.debe_ser}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Cd>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 13 }}>
            <Cd>
              <H>Depende de</H>
              {misDeps.length === 0 && <P style={{ color: 'var(--text-muted)' }}>Sin dependencias.</P>}
              {misDeps.map(x => {
                const o = matriz.find(m => m.id === x.depende_de_id)
                return <Dep key={x.depende_de_id} id={x.depende_de_id} nombre={o?.nombre} tipo={x.tipo} onAbrir={onAbrir} />
              })}
            </Cd>
            <Cd>
              <H>Procesos que dependen de este</H>
              {meRequieren.length === 0 && <P style={{ color: 'var(--text-muted)' }}>Ninguno.</P>}
              {meRequieren.map(x => {
                const o = matriz.find(m => m.id === x.proceso_id)
                return <Dep key={x.proceso_id} id={x.proceso_id} nombre={o?.nombre} tipo={x.tipo} onAbrir={onAbrir} />
              })}
            </Cd>
          </div>
        </div>
      )}

      {!loading && d && sub === 'editar' && (
        <PrcEditor proceso={p} d={d} cat={cat} cu={cu} toast={toast}
          onGuardado={refrescar} />
      )}

      {!loading && d && sub === 'sop' && (
        <PrcSOP proceso={p} cu={cu} matriz={matriz} comites={cat.comites}
          docs={d.docs} firmas={d.firmas} onRecargar={refrescar} toast={toast}
          bundle={{
            principios: d.principios, roles: d.roles, transicion: d.transicion, fases: d.fases,
            pasos: d.pasos, errores: d.errores, kpis: d.kpis,
            dependencias: misDeps.map(x => ({ depende_de_id: x.depende_de_id, tipo: x.tipo }))
          }} />
      )}

      {!loading && d && sub === 'flujo' && (
        <PrcFlujograma proceso={p} fases={d.fases} pasos={d.pasos}
          version={`Borrador v${(d.docs.find(x => x.tipo === 'SOP' && x.es_vigente) || d.docs.find(x => x.tipo === 'SOP') || {}).version || '0.1'}`} />
      )}

      {!loading && d && sub === 'avance' && (() => {
        const a = desgloseAvance({ proceso: p, d })
        const comps = [
          { k: 'sop', l: 'SOP', v: a.sop, peso: PESOS_AVANCE.sop },
          { k: 'flujograma', l: 'Flujograma', v: a.flujograma, peso: PESOS_AVANCE.flujograma },
          { k: 'capacitacion', l: 'Capacitación', v: a.capacitacion, peso: PESOS_AVANCE.capacitacion },
          { k: 'implementacion', l: 'Implementación', v: a.implementacion, peso: PESOS_AVANCE.implementacion }
        ]
        const faltan = a.items.filter(i => !i.ok)
        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <Ayuda k="avance2" titulo="Cómo se calcula el avance">
            El avance <b>se calcula solo</b> desde lo que existe en el sistema; nadie escribe porcentajes. Cuatro componentes con
            peso: <b>SOP 40%</b> (contenido de las 7 secciones, versión guardada, revisado, aprobado), <b>Flujograma 20%</b>
            (generado, versión guardada, aprobado), <b>Capacitación 20%</b> (registrada) e <b>Implementación 20%</b> (primera
            medición de KPI y estado IMPLEMENTADO). La lista de abajo dice exactamente qué falta para sumar puntos. Las
            <b> notas de avance</b> quedan como bitácora con la foto del % de ese día.
          </Ayuda>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {comps.map(c => <Mt key={c.k} l={`${c.l} · pesa ${c.peso}%`} v={pct(c.v)} sub={`aporta ${Math.round(c.v * c.peso / 100)} de ${c.peso} puntos`} />)}
            <Mt l="Avance global" v={pct(a.global)} sub={`${(d.docs || []).length ? '' : 'Sin versiones guardadas · '}${a.contenidoN}/7 secciones`} c="var(--accent)" />
          </div>
          <Cd>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>Qué suma y qué falta</span>
              <Bd c={faltan.length ? 'var(--warning)' : 'var(--success)'}>{faltan.length ? `${faltan.length} pendiente(s)` : 'todo completo'}</Bd>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 6 }}>
              {a.items.map((i, k) => (
                <div key={k} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '7px 10px', borderRadius: 9, background: 'var(--bg-page)', borderLeft: `3px solid ${i.ok ? 'var(--success)' : 'var(--border-2)'}` }}>
                  <span style={{ width: 18, height: 18, borderRadius: 9, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#fff', background: i.ok ? 'var(--success)' : 'var(--text-muted)' }}>{i.ok ? '✓' : '·'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{i.l} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {i.pts}/{i.max} pts de {i.comp}</span></div>
                    {!i.ok && i.falta && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Falta: {i.falta}</div>}
                  </div>
                </div>
              ))}
            </div>
          </Cd>
          <Cd style={{ padding: 13, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Notas de avance</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Qué avanzó y qué bloquea el siguiente paso. Cada nota guarda la foto del avance calculado ese día.</div>
            <div style={{ marginLeft: 'auto' }}>
              <Bt sm dis={!editable} onClick={abrirAvance} title="Deja una nota con la foto del avance de hoy">Registrar nota</Bt>
            </div>
          </Cd>
          <Cd style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={css.th}>Fecha</th><th style={css.th}>SOP</th><th style={css.th}>Flujo</th>
                <th style={css.th}>Capac.</th><th style={css.th}>Impl.</th><th style={css.th}>Global</th>
                <th style={css.th}>Nota</th><th style={css.th}>Registró</th>
              </tr></thead>
              <tbody>{d.avance.map(x => (
                <tr key={x.id}>
                  <td style={{ ...css.td, whiteSpace: 'nowrap' }}>{fFecha(x.fecha_corte)}</td>
                  <td style={css.td}>{pct(x.pct_sop)}</td>
                  <td style={css.td}>{pct(x.pct_flujograma)}</td>
                  <td style={css.td}>{pct(x.pct_capacitacion)}</td>
                  <td style={css.td}>{pct(x.pct_implementacion)}</td>
                  <td style={{ ...css.td, fontWeight: 700 }}>{pct(x.pct_global)}</td>
                  <td style={css.td}>{x.comentario}</td>
                  <td style={{ ...css.td, color: 'var(--text-muted)' }}>{x.registrado_por}</td>
                </tr>
              ))}</tbody>
            </table>
            {d.avance.length === 0 && <Vacio txt="Sin notas de avance" />}
          </Cd>
        </div>
        )
      })()}
      {!loading && d && sub === 'docs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        <Ayuda k="docsficha" titulo="Cómo leer esta tabla">
          Cada fila es una versión de un documento del proceso. Solo una puede estar <b>vigente</b> por tipo: al
          aprobar una versión nueva, la anterior pasa a <b>derogado</b> pero se conserva para auditoría. Si ves
          "pendiente" en la columna Aprobó, ese documento todavía no pasó por comité y no tiene validez operativa.
        </Ayuda>
        <Cd style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={css.th}>Código</th><th style={css.th}>Tipo</th><th style={css.th}>Versión</th>
              <th style={css.th}>Estado</th><th style={css.th}>Vigente</th><th style={css.th}>Emisión</th>
              <th style={css.th}>Elaboró</th><th style={css.th}>Aprobó</th><th style={css.th}>Próx. revisión</th>
            </tr></thead>
            <tbody>{d.docs.map(x => (
              <tr key={x.id}>
                <td style={{ ...css.td, fontFamily: 'ui-monospace, monospace' }}>{x.codigo}</td>
                <td style={css.td}><Bd c={x.tipo === 'SOP' ? 'var(--accent)' : 'var(--info)'}>{x.tipo}</Bd></td>
                <td style={css.td}>v{x.version}</td>
                <td style={css.td}><Bd c={x.estado === 'VIGENTE' ? 'var(--success)' : x.estado === 'BORRADOR' ? 'var(--warning)' : x.estado === 'DEROGADO' ? 'var(--text-muted)' : 'var(--info)'}>{x.estado}</Bd></td>
                <td style={css.td}>{x.es_vigente ? '✓' : '—'}</td>
                <td style={css.td}>{fFecha(x.fecha_emision)}</td>
                <td style={css.td}>{x.elaborado_por || '—'}</td>
                <td style={css.td}>{x.aprobado_por || <span style={{ color: 'var(--danger)' }}>pendiente</span>}</td>
                <td style={css.td}>{fFecha(x.proxima_revision)}</td>
              </tr>
            ))}</tbody>
          </table>
          {d.docs.length === 0 && <Vacio txt="Sin documentos registrados" ic="📁" />}
        </Cd>
        </div>
      )}

      {!loading && d && sub === 'capac' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <Ayuda k="capac" titulo="Por qué esto es obligatorio">
            Un SOP aprobado que nadie conoce no cambia nada. Este registro es la evidencia de que el equipo fue
            formado: fecha, facilitador y el listado de asistentes. Con una sesión registrada se cumple la etapa 5 de
            6. Si capacitas por sucursal, registra una sesión por cada una.
          </Ayuda>
          <Cd style={{ padding: 13, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Capacitaciones ejecutadas</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Requisito duro del estado IMPLEMENTADO.</div>
            <div style={{ marginLeft: 'auto' }}>
              <Bt sm dis={!editable} onClick={() => { setForm({ fecha: hoy(), facilitador: cu?.nombre, asistentes: '' }); setSheet('capac') }}
                title="Anota una sesión de capacitación con su listado de asistentes: es requisito para implementar">
                Registrar capacitación
              </Bt>
            </div>
          </Cd>
          <Cd style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={css.th}>Fecha</th><th style={css.th}>Sucursal</th><th style={css.th}>Facilitador</th>
                <th style={css.th}>Asistentes</th><th style={css.th}>Duración</th><th style={css.th}>Evaluación</th>
              </tr></thead>
              <tbody>{d.capac.map(c => (
                <tr key={c.id}>
                  <td style={css.td}>{fFecha(c.fecha)}</td>
                  <td style={css.td}>{c.sucursal || '—'}</td>
                  <td style={css.td}>{c.facilitador || '—'}</td>
                  <td style={css.td}>
                    <b>{c.n_asistentes}</b>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {Array.isArray(c.asistentes) ? c.asistentes.join(', ') : ''}
                    </div>
                  </td>
                  <td style={css.td}>{c.duracion_min ? c.duracion_min + ' min' : '—'}</td>
                  <td style={css.td}>{c.evaluacion_aplicada ? '✓' : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
            {d.capac.length === 0 && <Vacio txt="Sin capacitaciones registradas" ic="🎓" />}
          </Cd>
        </div>
      )}

      {!loading && d && sub === 'kpi' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <Ayuda k="kpi" titulo="Cómo se usan los indicadores">
            Los indicadores se definen en la pestaña <b>Editar</b> y se miden acá. Cada medición lleva un período
            (por ejemplo 2026-08) y el valor obtenido. La primera medición registrada cierra la etapa 6 y habilita
            marcar el proceso como implementado. El indicador marcado como <b>ancla</b> es el que resume la salud del
            proceso.
          </Ayuda>
          <Cd style={{ padding: 13, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Indicadores del proceso</div>
            <div style={{ marginLeft: 'auto' }}>
              <Bt sm dis={!editable || !d.kpis.length}
                onClick={() => { setForm({ kpi_id: d.kpis[0]?.id, periodo: hoy().slice(0, 7), cumple: '' }); setSheet('medicion') }}
                title={d.kpis.length ? 'Registra el valor de un indicador para un período' : 'Primero define indicadores en la pestaña Editar'}>
                Registrar medición
              </Bt>
            </div>
          </Cd>
          <Cd style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={css.th}>Indicador</th><th style={css.th}>Definición operacional</th>
                <th style={css.th}>Meta</th><th style={css.th}>Frecuencia</th><th style={css.th}>Responsable</th>
                <th style={css.th}>Pond.</th><th style={css.th}>Mediciones</th>
              </tr></thead>
              <tbody>{d.kpis.map(k => {
                const ms = d.mediciones.filter(m => m.kpi_id === k.id)
                return (
                  <tr key={k.id}>
                    <td style={{ ...css.td, fontWeight: 700 }}>{k.indicador} {k.es_kpi_ancla && <Bd c="var(--accent)">ancla</Bd>}</td>
                    <td style={css.td}>{k.definicion_operacional}</td>
                    <td style={{ ...css.td, fontWeight: 600 }}>{k.meta}</td>
                    <td style={css.td}>{k.frecuencia}</td>
                    <td style={css.td}>{k.responsable}</td>
                    <td style={css.td}>{k.ponderacion ? k.ponderacion + '%' : '—'}</td>
                    <td style={css.td}>
                      {ms.length === 0 ? <span style={{ color: 'var(--text-muted)' }}>sin datos</span>
                        : ms.slice(0, 3).map(m => (
                          <div key={m.id} style={{ fontSize: 11.5 }}>
                            <b>{m.periodo}</b>: {m.valor ?? m.valor_texto ?? '—'}
                            {m.cumple === true && <span style={{ color: 'var(--success)' }}> ✓</span>}
                            {m.cumple === false && <span style={{ color: 'var(--danger)' }}> ✗</span>}
                          </div>
                        ))}
                    </td>
                  </tr>
                )
              })}</tbody>
            </table>
            {d.kpis.length === 0 && <Vacio txt="Sin indicadores definidos" ic="🎯" />}
          </Cd>
        </div>
      )}

      {!loading && d && sub === 'bitacora' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <Ayuda k="bitacora" titulo="Qué se anota en la bitácora">
            La historia del proceso: diseños, revisiones, aprobaciones, capacitaciones, mediciones, incidentes y
            acuerdos de comité. Las aprobaciones y los acuerdos se escriben solos cuando firmas o registras un
            acuerdo; el resto lo agregas a mano cuando pasa algo que conviene dejar registrado.
          </Ayuda>
          <Cd style={{ padding: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Bitácora del proceso</div>
            <div style={{ marginLeft: 'auto' }}>
              <Bt sm dis={!editable} onClick={() => { setForm({ fecha: hoy(), tipo: 'REVISION', descripcion: '' }); setSheet('hito') }}
                title="Deja registro de un evento del proceso: revisión, incidente, medición o acuerdo">
                Agregar hito
              </Bt>
            </div>
          </Cd>
          <Cd>
            {d.hitos.length === 0 && <Vacio txt="Sin hitos registrados" ic="🕘" />}
            {d.hitos.map(h => (
              <div key={h.id} style={{
                display: 'flex', gap: 11, padding: '9px 11px', borderRadius: 9,
                background: 'var(--bg-page)', marginBottom: 6, alignItems: 'flex-start'
              }}>
                <Bd c="var(--accent)">{h.tipo}</Bd>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5 }}>{h.descripcion}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.responsable}</div>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fFecha(h.fecha)}</div>
              </div>
            ))}
          </Cd>
        </div>
      )}

      {/* ── sheets ── */}
      <Sheet open={sheet === 'avance'} onClose={() => setSheet(null)} title={`Nota de avance · ${id}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <F l="Fecha"><input type="date" style={css.input} value={form.fecha_corte || ''} onChange={e => setForm({ ...form, fecha_corte: e.target.value })} /></F>
          <F l="Nota (obligatoria)">
            <textarea rows={3} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }}
              value={form.comentario || ''} onChange={e => setForm({ ...form, comentario: e.target.value })}
              placeholder="Qué avanzó desde la nota anterior y qué bloquea el siguiente paso." />
          </F>
          <Hint>Se guarda con la foto del avance calculado hoy: {pct(p.pct_global)} global.</Hint>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Bt v="sec" onClick={() => setSheet(null)}>Cancelar</Bt>
            <Bt dis={busy} onClick={guardarAvance}>Guardar nota</Bt>
          </div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'capac'} onClose={() => setSheet(null)} title={`Registrar capacitación · ${id}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <F l="Fecha"><input type="date" style={css.input} value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} /></F>
            <F l="Sucursal">
              <select style={{ ...css.input, cursor: 'pointer' }} value={form.sucursal || ''} onChange={e => setForm({ ...form, sucursal: e.target.value })}>
                <option value="">Todas / corporativo</option>
                <option>La Granja</option><option>Los Ángeles</option><option>CD Maipú</option><option>Sucursal Maipú</option>
              </select>
            </F>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <F l="Facilitador"><input style={css.input} value={form.facilitador || ''} onChange={e => setForm({ ...form, facilitador: e.target.value })} /></F>
            <F l="Duración (min)"><input type="number" style={css.input} value={form.duracion || ''} onChange={e => setForm({ ...form, duracion: e.target.value })} /></F>
          </div>
          <F l="Asistentes (uno por línea o separados por coma)">
            <textarea rows={4} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }}
              value={form.asistentes || ''} onChange={e => setForm({ ...form, asistentes: e.target.value })} />
          </F>
          <F l="Enlace a la evidencia (lista de asistencia, fotos)">
            <input style={css.input} placeholder="https://drive.google.com/…" value={form.evidencia || ''} onChange={e => setForm({ ...form, evidencia: e.target.value })} />
          </F>
          <label style={{ fontSize: 12.5, display: 'flex', gap: 7, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.evaluacion} onChange={e => setForm({ ...form, evaluacion: e.target.checked })} />
            Se aplicó evaluación de comprensión
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Bt v="sec" onClick={() => setSheet(null)}>Cancelar</Bt>
            <Bt dis={busy} onClick={guardarCapac}>Registrar</Bt>
          </div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'medicion'} onClose={() => setSheet(null)} title={`Registrar medición de KPI · ${id}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <F l="Indicador">
            <select style={{ ...css.input, cursor: 'pointer' }} value={form.kpi_id || ''} onChange={e => setForm({ ...form, kpi_id: e.target.value })}>
              {(d?.kpis || []).map(k => <option key={k.id} value={k.id}>{k.indicador}</option>)}
            </select>
          </F>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9 }}>
            <F l="Período"><input style={css.input} placeholder="2026-08" value={form.periodo || ''} onChange={e => setForm({ ...form, periodo: e.target.value })} /></F>
            <F l="Valor"><input type="number" step="any" style={css.input} value={form.valor ?? ''} onChange={e => setForm({ ...form, valor: e.target.value })} /></F>
            <F l="¿Cumple la meta?">
              <select style={{ ...css.input, cursor: 'pointer' }} value={form.cumple || ''} onChange={e => setForm({ ...form, cumple: e.target.value })}>
                <option value="">Sin evaluar</option><option value="si">Sí</option><option value="no">No</option>
              </select>
            </F>
          </div>
          <F l="Comentario">
            <textarea rows={3} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }}
              value={form.comentario || ''} onChange={e => setForm({ ...form, comentario: e.target.value })} />
          </F>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            La primera medición registrada habilita el cuarto criterio de implementación.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Bt v="sec" onClick={() => setSheet(null)}>Cancelar</Bt>
            <Bt dis={busy} onClick={guardarMedicion}>Registrar</Bt>
          </div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'hito'} onClose={() => setSheet(null)} title={`Agregar hito · ${id}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            <F l="Fecha"><input type="date" style={css.input} value={form.fecha || ''} onChange={e => setForm({ ...form, fecha: e.target.value })} /></F>
            <F l="Tipo">
              <select style={{ ...css.input, cursor: 'pointer' }} value={form.tipo || 'REVISION'} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                {['DISENO', 'REVISION', 'APROBACION', 'CAPACITACION', 'MEDICION', 'INCIDENTE', 'COMITE'].map(t => <option key={t}>{t}</option>)}
              </select>
            </F>
          </div>
          <F l="Descripción">
            <textarea rows={3} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }}
              value={form.descripcion || ''} onChange={e => setForm({ ...form, descripcion: e.target.value })} />
          </F>
          <F l="Evidencia (enlace)"><input style={css.input} value={form.evidencia || ''} onChange={e => setForm({ ...form, evidencia: e.target.value })} /></F>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Bt v="sec" onClick={() => setSheet(null)}>Cancelar</Bt>
            <Bt dis={busy} onClick={guardarHito}>Agregar</Bt>
          </div>
        </div>
      </Sheet>

      <Sheet open={sheet === 'archivar'} onClose={() => setSheet(null)} title={`Archivar ${id} · ${p.nombre}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: '10px 13px', borderRadius: 9, background: 'var(--warning-bg)', color: 'var(--warning-text)', fontSize: 12.5, lineHeight: 1.6 }}>
            El proceso <b>sale de la matriz, del dashboard y de las alertas</b>, pero conserva todo: SOP, versiones,
            firmas, avance y bitácora. No es un borrado — puedes reactivarlo cuando quieras desde
            <b> Matriz → Archivados</b>, y desde ahí también se puede eliminar definitivamente si corresponde.
          </div>
          {(d?.docs || []).some(x => x.es_vigente) && (
            <div style={{ padding: '10px 13px', borderRadius: 9, background: 'var(--danger-bg)', color: 'var(--danger-text)', fontSize: 12.5 }}>
              Ojo: este proceso tiene un documento <b>vigente</b>. Archivarlo lo saca de la vista pero el documento
              sigue siendo oficial — si la intención es dejarlo sin efecto, primero derógalo en la pestaña SOP.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Bt v="sec" onClick={() => setSheet(null)}>Cancelar</Bt>
            <Bt v="warn" dis={busy} onClick={archivar}>Archivar {id}</Bt>
          </div>
        </div>
      </Sheet>
    </div>
  )
}

/* ── auxiliares ──────────────────────────────────────────────────────────── */
const H = ({ children, style }) => (
  <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .3, color: 'var(--text-muted)', ...style }}>{children}</div>
)
const P = ({ children, style }) => (
  <p style={{ fontSize: 13, lineHeight: 1.65, margin: '5px 0 0', ...style }}>{children}</p>
)
const F = ({ l, children }) => (
  <div><label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>{l}</label>{children}</div>
)
const Dep = ({ id, nombre, tipo, onAbrir }) => (
  <div onClick={() => onAbrir(id)} style={{
    display: 'flex', gap: 9, alignItems: 'center', padding: '7px 10px', borderRadius: 9,
    background: 'var(--bg-page)', marginBottom: 5, cursor: 'pointer'
  }}>
    <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: 12, color: 'var(--accent)' }}>{id}</span>
    <span style={{ flex: 1, fontSize: 12.5 }}>{nombre || '—'}</span>
    <Bd c={tipo === 'bloqueante' ? 'var(--danger)' : tipo === 'bidireccional' ? 'var(--info)' : 'var(--text-muted)'}>{tipo}</Bd>
  </div>
)
