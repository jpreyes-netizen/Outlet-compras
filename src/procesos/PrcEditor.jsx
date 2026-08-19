// src/procesos/PrcEditor.jsx
// Editor del contenido del proceso: identificación, principios, roles, transición,
// fases con sus pasos y errores, e indicadores. Todo lo que alimenta el SOP y el
// flujograma se edita acá, con guardado explícito por sección.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import {
  Cd, Bt, Bd, Ayuda, Hint, Campo, BtIc, BtEliminar, Sucio, Vacio,
  css, uid, puedeEditar
} from './prcUI'
import { PrcDisenador } from './PrcDisenador'

const FRECUENCIAS = ['DIARIA', 'SEMANAL', 'MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL']

/* ── sincronización genérica: borra las quitadas, inserta y actualiza el resto ── */
async function sincronizar(tabla, filas, idsOriginales) {
  const ids = new Set(filas.map(f => f.id))
  const borrar = idsOriginales.filter(x => !ids.has(x))
  if (borrar.length) {
    const { error } = await supabase.from(tabla).delete().in('id', borrar)
    if (error) return error
  }
  if (filas.length) {
    const { error } = await supabase.from(tabla).upsert(filas)
    if (error) return error
  }
  return null
}

const mover = (arr, i, delta) => {
  const j = i + delta
  if (j < 0 || j >= arr.length) return arr
  const copia = [...arr]
  ;[copia[i], copia[j]] = [copia[j], copia[i]]
  return copia
}

/* ═══════════════════════════════════════════════════════════════════════════
   Sección contenedora con título, ayuda y estado de guardado
   ═══════════════════════════════════════════════════════════════════════════ */
function Seccion({ n, titulo, sub, sucio, guardando, onGuardar, onDescartar, children, editable }) {
  return (
    <Cd>
      <div style={{
        display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap',
        paddingBottom: 11, marginBottom: 13, borderBottom: '1px solid var(--border-1)'
      }}>
        <div style={{
          width: 26, height: 26, borderRadius: 8, background: 'var(--bg-page)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 800, color: 'var(--text-muted)'
        }}>{n}</div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14.5, fontWeight: 700 }}>{titulo}</span>
            <Sucio hay={sucio} />
          </div>
          {sub && <Hint>{sub}</Hint>}
        </div>
        {editable && (
          <div style={{ display: 'flex', gap: 7 }}>
            {sucio && <Bt v="ghost" sm onClick={onDescartar} title="Vuelve a los valores guardados">Descartar</Bt>}
            <Bt sm dis={!sucio || guardando} onClick={onGuardar}
              title={sucio ? 'Guarda los cambios de esta sección en la base de datos' : 'No hay cambios por guardar'}>
              {guardando ? 'Guardando…' : 'Guardar sección'}
            </Bt>
          </div>
        )}
      </div>
      {children}
    </Cd>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Editor genérico de listas (principios, roles, transición, KPI)
   ═══════════════════════════════════════════════════════════════════════════ */
function Lista({ campos, filas, setFilas, editable, etiquetaAgregar, nuevo, listaRoles }) {
  const grid = campos.map(c => c.ancho || '1fr').join(' ') + (editable ? ' 74px' : '')
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 8, marginBottom: 6 }}>
        {campos.map(c => (
          <div key={c.k} style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .3, color: 'var(--text-muted)' }}>
            {c.l}
          </div>
        ))}
        {editable && <div />}
      </div>

      {filas.length === 0 && <Vacio txt="Todavía no hay filas. Usa el botón de abajo para agregar la primera." />}

      {filas.map((f, i) => (
        <div key={f.id} style={{ display: 'grid', gridTemplateColumns: grid, gap: 8, marginBottom: 7, alignItems: 'start' }}>
          {campos.map(c => {
            const val = f[c.k] ?? ''
            const set = v => setFilas(prev => prev.map((x, j) => j === i ? { ...x, [c.k]: v } : x))
            if (!editable) return <div key={c.k} style={{ fontSize: 12.5, padding: '6px 0' }}>{val || '—'}</div>
            if (c.tipo === 'select') return (
              <select key={c.k} style={{ ...css.input, cursor: 'pointer' }} value={val} onChange={e => set(e.target.value)}>
                <option value="">—</option>
                {c.opts.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )
            if (c.tipo === 'textarea') return (
              <textarea key={c.k} rows={2} placeholder={c.ph} value={val} onChange={e => set(e.target.value)}
                style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit', fontSize: 12.5, padding: '7px 9px' }} />
            )
            if (c.tipo === 'check') return (
              <label key={c.k} style={{ fontSize: 11.5, display: 'flex', gap: 5, alignItems: 'center', padding: '8px 0', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!f[c.k]} onChange={e => set(e.target.checked)} /> {c.corto || c.l}
              </label>
            )
            return (
              <input key={c.k} placeholder={c.ph} value={val} onChange={e => set(e.target.value)}
                list={c.lista === 'roles' ? listaRoles : undefined}
                style={{ ...css.input, fontSize: 12.5, padding: '7px 9px' }} />
            )
          })}
          {editable && (
            <div style={{ display: 'flex', gap: 3, paddingTop: 4 }}>
              <BtIc ic="↑" title="Subir una posición" dis={i === 0} onClick={() => setFilas(p => mover(p, i, -1))} />
              <BtIc ic="↓" title="Bajar una posición" dis={i === filas.length - 1} onClick={() => setFilas(p => mover(p, i, 1))} />
              <BtEliminar title="Quitar esta fila" onConfirm={() => setFilas(p => p.filter((_, j) => j !== i))} />
            </div>
          )}
        </div>
      ))}

      {editable && (
        <Bt v="sec" sm onClick={() => setFilas(p => [...p, { ...nuevo(), id: 'NUEVO-' + uid() }])}
          style={{ marginTop: 6 }} title="Agrega una fila vacía al final de la lista">
          ＋ {etiquetaAgregar}
        </Bt>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   EDITOR PRINCIPAL
   ═══════════════════════════════════════════════════════════════════════════ */
export function PrcEditor({ proceso, d, cat, cu, onGuardado, toast }) {
  const editable = puedeEditar(cu)
  const [busy, setBusy] = useState('')

  /* ── estado local por sección ── */
  const [ficha, setFicha] = useState({})
  const [principios, setPrincipios] = useState([])
  const [roles, setRoles] = useState([])
  const [transicion, setTransicion] = useState([])
  const [kpis, setKpis] = useState([])
  const [fases, setFases] = useState([])
  const [pasos, setPasos] = useState([])
  const [errores, setErrores] = useState([])
  const [faseAbierta, setFaseAbierta] = useState(null)
  const [vistaFlujo, setVistaFlujo] = useState(() => {
    try { return localStorage.getItem('prc_vista_flujo') || 'form' } catch { return 'form' }
  })
  const cambiarVista = (v) => {
    setVistaFlujo(v)
    try { localStorage.setItem('prc_vista_flujo', v) } catch { /* sin storage */ }
  }

  const reset = () => {
    setFicha({
      objetivo: proceso.objetivo || '', alcance: proceso.alcance || '', regla_critica: proceso.regla_critica || '',
      dueno_cargo: proceso.dueno_cargo || '', dueno_persona: proceso.dueno_persona || '',
      dueno_provisional: !!proceso.dueno_provisional, comite_codigo: proceso.comite_codigo || '',
      impacto: proceso.impacto, urgencia: proceso.urgencia, onda: proceso.onda || '',
      fecha_objetivo_vigente: proceso.fecha_objetivo_vigente || '', observaciones: proceso.observaciones || '',
      meses_revision: proceso.meses_revision || 6, sistemas: proceso.sistemas || []
    })
    setPrincipios((d.principios || []).map(x => ({ ...x })))
    setRoles((d.roles || []).map(x => ({ ...x })))
    setTransicion((d.transicion || []).map(x => ({ ...x })))
    setKpis((d.kpis || []).map(x => ({ ...x })))
    setFases((d.fases || []).map(x => ({ ...x })))
    setPasos((d.pasos || []).map(x => ({ ...x })))
    setErrores((d.errores || []).map(x => ({ ...x })))
  }
  useEffect(reset, [proceso.id, d])

  const orig = useMemo(() => ({
    principios: (d.principios || []).map(x => x.id), roles: (d.roles || []).map(x => x.id),
    transicion: (d.transicion || []).map(x => x.id), kpis: (d.kpis || []).map(x => x.id),
    fases: (d.fases || []).map(x => x.id), pasos: (d.pasos || []).map(x => x.id),
    errores: (d.errores || []).map(x => x.id)
  }), [d])

  const listaRoles = 'roles-' + proceso.id
  const dif = (a, b) => JSON.stringify(a) !== JSON.stringify(b)
  const sucioFicha = dif(ficha, {
    objetivo: proceso.objetivo || '', alcance: proceso.alcance || '', regla_critica: proceso.regla_critica || '',
    dueno_cargo: proceso.dueno_cargo || '', dueno_persona: proceso.dueno_persona || '',
    dueno_provisional: !!proceso.dueno_provisional, comite_codigo: proceso.comite_codigo || '',
    impacto: proceso.impacto, urgencia: proceso.urgencia, onda: proceso.onda || '',
    fecha_objetivo_vigente: proceso.fecha_objetivo_vigente || '', observaciones: proceso.observaciones || '',
    meses_revision: proceso.meses_revision || 6, sistemas: proceso.sistemas || []
  })
  const sucioPrincipios = dif(principios, d.principios)
  const sucioRoles = dif(roles, d.roles)
  const sucioTransicion = dif(transicion, d.transicion)
  const sucioKpis = dif(kpis, d.kpis)
  const sucioFlujo = dif(fases, d.fases) || dif(pasos, d.pasos) || dif(errores, d.errores)

  const ok = (msg) => { toast(msg); onGuardado() }
  const fallo = (e) => toast('No se pudo guardar: ' + (e.message || e), 'err')

  /* ── guardados ── */
  const guardarFicha = async () => {
    if (!ficha.objetivo.trim() || !ficha.alcance.trim() || !ficha.regla_critica.trim())
      return toast('Objetivo, alcance y regla crítica son obligatorios: son las tres primeras secciones del SOP.', 'err')
    setBusy('ficha')
    const { error } = await supabase.from('prc_procesos').update({
      objetivo: ficha.objetivo.trim(), alcance: ficha.alcance.trim(), regla_critica: ficha.regla_critica.trim(),
      dueno_cargo: ficha.dueno_cargo || null, dueno_persona: ficha.dueno_persona || null,
      dueno_provisional: ficha.dueno_provisional, comite_codigo: ficha.comite_codigo || null,
      impacto: ficha.impacto, urgencia: ficha.urgencia, onda: ficha.onda || null,
      fecha_objetivo_vigente: ficha.fecha_objetivo_vigente || null,
      observaciones: ficha.observaciones || null, meses_revision: +ficha.meses_revision || 6,
      sistemas: ficha.sistemas
    }).eq('id', proceso.id)
    setBusy('')
    error ? fallo(error) : ok('Identificación actualizada')
  }

  const guardarLista = async (tabla, filas, ids, campoObligatorio, etiqueta, extra = {}) => {
    const limpias = filas.filter(f => String(f[campoObligatorio] || '').trim())
    if (limpias.length !== filas.length) return toast(`Hay filas sin ${etiqueta}. Complétalas o quítalas.`, 'err')
    setBusy(tabla)
    const rows = limpias.map((f, i) => {
      const { id, ...resto } = f
      return {
        ...resto, ...extra, proceso_id: proceso.id, orden: i + 1,
        id: String(id).startsWith('NUEVO-') ? `${proceso.id}-${tabla.replace('prc_', '').slice(0, 3).toUpperCase()}-${uid()}` : id
      }
    })
    const error = await sincronizar(tabla, rows, ids)
    setBusy('')
    error ? fallo(error) : ok(etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1) + ' guardados')
  }

  const guardarFlujo = async () => {
    if (fases.some(f => !String(f.nombre || '').trim()))
      return toast('Hay fases sin nombre. Complétalas o quítalas.', 'err')
    const sinAccion = pasos.filter(p => !String(p.accion || '').trim())
    if (sinAccion.length) return toast(`Hay ${sinAccion.length} paso(s) sin acción. Complétalos o quítalos.`, 'err')
    const sinResp = pasos.filter(p => !String(p.responsable || '').trim())
    if (sinResp.length) return toast(`Hay ${sinResp.length} paso(s) sin responsable. El responsable define el carril del flujograma.`, 'err')

    setBusy('flujo')
    // 1. Fases renumeradas, con id definitivo
    const mapaId = {}
    const filasFases = fases.map((f, i) => {
      const nuevoId = String(f.id).startsWith('NUEVO-') ? `${proceso.id}-F-${uid()}` : f.id
      mapaId[f.id] = nuevoId
      const { id, ...resto } = f
      return { ...resto, id: nuevoId, proceso_id: proceso.id, orden: i + 1 }
    })
    let error = await sincronizar('prc_fases', filasFases, orig.fases)
    if (error) { setBusy(''); return fallo(error) }

    // 2. Pasos, renumerados dentro de su fase
    const filasPasos = []
    filasFases.forEach(f => {
      pasos.filter(p => mapaId[p.fase_id] === f.id || p.fase_id === f.id)
        .forEach((p, i) => {
          const { id, ...resto } = p
          filasPasos.push({
            ...resto, id: String(id).startsWith('NUEVO-') ? `${f.id}-${uid()}` : id,
            fase_id: f.id, proceso_id: proceso.id, orden: i + 1,
            rama_si: p.es_decision ? (p.rama_si || null) : null,
            rama_no: p.es_decision ? (p.rama_no || null) : null
          })
        })
    })
    error = await sincronizar('prc_pasos', filasPasos, orig.pasos)
    if (error) { setBusy(''); return fallo(error) }

    // 3. Errores frecuentes
    const filasErr = []
    filasFases.forEach(f => {
      errores.filter(e => mapaId[e.fase_id] === f.id || e.fase_id === f.id)
        .filter(e => String(e.error || '').trim())
        .forEach((e, i) => {
          const { id, ...resto } = e
          filasErr.push({
            ...resto, id: String(id).startsWith('NUEVO-') ? `${f.id}-E-${uid()}` : id,
            fase_id: f.id, proceso_id: proceso.id, orden: i + 1
          })
        })
    })
    error = await sincronizar('prc_errores', filasErr, orig.errores)
    setBusy('')
    error ? fallo(error) : ok(`Flujo guardado: ${filasFases.length} fases y ${filasPasos.length} pasos`)
  }

  /* ── helpers de fases ── */
  const agregarFase = () => {
    const id = 'NUEVO-' + uid()
    setFases(p => [...p, { id, proceso_id: proceso.id, nombre: '', responsable_principal: '', descripcion: '', color: '#334155', orden: p.length + 1 }])
    setFaseAbierta(id)
  }
  const agregarPaso = (faseId) => setPasos(p => [...p, {
    id: 'NUEVO-' + uid(), fase_id: faseId, proceso_id: proceso.id, accion: '', responsable: '',
    sistema: '', control_tiempo: '', es_control_critico: false, es_decision: false, rama_si: '', rama_no: ''
  }])
  const agregarError = (faseId) => setErrores(p => [...p, {
    id: 'NUEVO-' + uid(), fase_id: faseId, proceso_id: proceso.id, error: '', consecuencia: '', prevencion: ''
  }])
  const pasosDe = faseId => pasos.filter(p => p.fase_id === faseId)
  const setPasoCampo = (id, k, v) => setPasos(p => p.map(x => x.id === id ? { ...x, [k]: v } : x))
  const moverPaso = (faseId, i, delta) => {
    const lista = pasosDe(faseId)
    const movida = mover(lista, i, delta)
    if (movida === lista) return
    setPasos(prev => {
      const otros = prev.filter(p => p.fase_id !== faseId)
      return [...otros, ...movida]
    })
  }

  const vigente = (d.docs || []).find(x => x.tipo === 'SOP' && x.es_vigente)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>

      <datalist id={listaRoles}>
        {roles.map(r => <option key={r.id} value={r.rol} />)}
      </datalist>

      <Ayuda k="editor" titulo="Cómo funciona esta pantalla">
        <p style={{ margin: '0 0 6px' }}>
          Acá se escribe el proceso. Cada sección corresponde a una sección del documento SOP: lo que edites acá es
          exactamente lo que va a salir en el SOP y en el flujograma.
        </p>
        <ul style={{ margin: '0 0 6px 16px', padding: 0 }}>
          <li><b>Cada sección se guarda por separado</b> con su botón "Guardar sección". Mientras haya cambios sin
            guardar verás una marca naranja.</li>
          <li><b>El orden importa.</b> Usa las flechas ↑ ↓ para mover principios, roles, fases y pasos.</li>
          <li><b>El responsable de cada paso define su carril</b> en el flujograma swimlane. Si escribes un
            responsable nuevo, aparece un carril nuevo.</li>
          <li><b>Editar acá no cambia el documento aprobado.</b> Para que los cambios se oficialicen hay que
            guardar una versión nueva en la pestaña SOP y volver a firmarla.</li>
        </ul>
      </Ayuda>

      {vigente && (
        <div style={{
          padding: '10px 14px', borderRadius: 10, background: 'var(--warning-bg)',
          color: 'var(--warning-text)', fontSize: 12.5, borderLeft: '3px solid var(--warning)'
        }}>
          <b>Atención:</b> este proceso tiene el SOP {vigente.codigo} v{vigente.version} vigente y aprobado.
          Lo que edites acá queda como borrador de la próxima versión; el documento vigente no se altera hasta que
          guardes y firmes una versión nueva.
        </div>
      )}

      {!editable && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg-page)', fontSize: 12.5, color: 'var(--text-muted)' }}>
          Tu rol es de solo lectura: puedes ver el contenido pero no modificarlo.
        </div>
      )}

      {/* ── 1. Identificación ── */}
      <Seccion n="1" titulo="Identificación y prioridad" editable={editable}
        sub="Secciones 1 y 2 del SOP, más la priorización que ordena la matriz."
        sucio={sucioFicha} guardando={busy === 'ficha'} onGuardar={guardarFicha} onDescartar={reset}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Campo l="Objetivo" obligatorio hint="Para qué existe el proceso, con especificidad operativa. Evita frases genéricas.">
            <textarea rows={3} disabled={!editable} value={ficha.objetivo || ''}
              onChange={e => setFicha({ ...ficha, objetivo: e.target.value })}
              style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} />
          </Campo>
          <Campo l="Alcance" obligatorio hint="Qué sucursales, canales y casos cubre. Declara también lo que queda excluido.">
            <textarea rows={2} disabled={!editable} value={ficha.alcance || ''}
              onChange={e => setFicha({ ...ficha, alcance: e.target.value })}
              style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} />
          </Campo>
          <Campo l="Regla crítica" obligatorio hint="La regla número uno: si no se cumple, el proceso completo falla. Sale destacada en rojo en el SOP.">
            <textarea rows={2} disabled={!editable} value={ficha.regla_critica || ''}
              onChange={e => setFicha({ ...ficha, regla_critica: e.target.value })}
              style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} />
          </Campo>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 11 }}>
            <Campo l="Cargo dueño del proceso" hint="El cargo que responde, exista o no la persona.">
              <input disabled={!editable} style={css.input} value={ficha.dueno_cargo || ''}
                onChange={e => setFicha({ ...ficha, dueno_cargo: e.target.value })} />
            </Campo>
            <Campo l="Persona a cargo" hint="Déjalo vacío si el cargo está vacante.">
              <input disabled={!editable} style={css.input} value={ficha.dueno_persona || ''}
                onChange={e => setFicha({ ...ficha, dueno_persona: e.target.value })} />
            </Campo>
            <Campo l="Comité que aprueba" hint="Dónde se presenta y se firma la aprobación.">
              <select disabled={!editable} style={{ ...css.input, cursor: 'pointer' }} value={ficha.comite_codigo || ''}
                onChange={e => setFicha({ ...ficha, comite_codigo: e.target.value })}>
                <option value="">Sin comité asignado</option>
                {cat.comites.map(c => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
              </select>
            </Campo>
            <Campo l="Impacto" hint="A alto · M medio · B bajo. Multiplica con urgencia para el score.">
              <select disabled={!editable} style={{ ...css.input, cursor: 'pointer' }} value={ficha.impacto || 'M'}
                onChange={e => setFicha({ ...ficha, impacto: e.target.value })}>
                <option value="A">A — Alto</option><option value="M">M — Medio</option><option value="B">B — Bajo</option>
              </select>
            </Campo>
            <Campo l="Urgencia" hint={`Score actual: ${proceso.score}`}>
              <select disabled={!editable} style={{ ...css.input, cursor: 'pointer' }} value={ficha.urgencia || 'M'}
                onChange={e => setFicha({ ...ficha, urgencia: e.target.value })}>
                <option value="A">A — Alta</option><option value="M">M — Media</option><option value="B">B — Baja</option>
              </select>
            </Campo>
            <Campo l="Onda de implementación" hint="En qué tramo del plan va este proceso.">
              <select disabled={!editable} style={{ ...css.input, cursor: 'pointer' }} value={ficha.onda || ''}
                onChange={e => setFicha({ ...ficha, onda: e.target.value })}>
                <option value="">Sin onda</option>
                {cat.ondas.map(o => <option key={o.codigo} value={o.codigo}>{o.nombre} · {o.ventana}</option>)}
              </select>
            </Campo>
            <Campo l="Fecha objetivo vigente" hint="Contra esta fecha se calculan los días de atraso. Cámbiala si replanificas.">
              <input type="date" disabled={!editable} style={css.input} value={ficha.fecha_objetivo_vigente || ''}
                onChange={e => setFicha({ ...ficha, fecha_objetivo_vigente: e.target.value })} />
            </Campo>
            <Campo l="Revisión cada (meses)" hint="Al aprobar el SOP se agenda la próxima revisión con este plazo.">
              <input type="number" min={1} max={36} disabled={!editable} style={css.input} value={ficha.meses_revision || 6}
                onChange={e => setFicha({ ...ficha, meses_revision: e.target.value })} />
            </Campo>
          </div>

          <Campo l="Sistemas que usa el proceso" hint="Marca los sistemas involucrados. Aparecen como etiquetas en la ficha.">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
              {cat.sistemas.map(s => {
                const on = (ficha.sistemas || []).includes(s.codigo)
                return (
                  <button key={s.codigo} disabled={!editable} onClick={() => setFicha(f => ({
                    ...f, sistemas: on ? f.sistemas.filter(x => x !== s.codigo) : [...(f.sistemas || []), s.codigo]
                  }))} style={{
                    padding: '5px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 600, minHeight: 0,
                    cursor: editable ? 'pointer' : 'default',
                    border: `1px solid ${on ? s.color : 'var(--border-2)'}`,
                    background: on ? s.color + '1f' : 'var(--bg-surface)',
                    color: on ? s.color : 'var(--text-muted)'
                  }}>{on ? '✓ ' : ''}{s.etiqueta}</button>
                )
              })}
            </div>
          </Campo>

          <Campo l="Observaciones" hint="Contexto, diagnóstico o brechas conocidas. No sale en el SOP formal.">
            <textarea rows={2} disabled={!editable} value={ficha.observaciones || ''}
              onChange={e => setFicha({ ...ficha, observaciones: e.target.value })}
              style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} />
          </Campo>
        </div>
      </Seccion>

      {/* ── 2. Principios ── */}
      <Seccion n="2" titulo="Principios operativos" editable={editable}
        sub="Sección 3 del SOP. Las reglas de criterio que guían las decisiones del día a día."
        sucio={sucioPrincipios} guardando={busy === 'prc_principios'} onDescartar={reset}
        onGuardar={() => guardarLista('prc_principios', principios, orig.principios, 'texto', 'principios')}>
        <Lista editable={editable} filas={principios} setFilas={setPrincipios} etiquetaAgregar="Agregar principio"
          nuevo={() => ({ texto: '' })}
          campos={[{ k: 'texto', l: 'Principio', tipo: 'textarea', ph: 'Ej: quien vende no cobra; la separación de funciones es un control, no una molestia.' }]} />
      </Seccion>

      {/* ── 3. Roles ── */}
      <Seccion n="3" titulo="Roles y límites" editable={editable}
        sub="Sección 4 del SOP. La columna de límite es la que previene la invasión de funciones entre cargos."
        sucio={sucioRoles} guardando={busy === 'prc_roles'} onDescartar={reset}
        onGuardar={() => guardarLista('prc_roles', roles, orig.roles, 'rol', 'roles')}>
        <Lista editable={editable} filas={roles} setFilas={setRoles} etiquetaAgregar="Agregar rol"
          nuevo={() => ({ rol: '', funcion: '', limite: '' })}
          campos={[
            { k: 'rol', l: 'Rol', ancho: '170px', ph: 'Ej: Cajero/a' },
            { k: 'funcion', l: 'Función en este proceso', tipo: 'textarea', ph: 'Qué hace concretamente acá' },
            { k: 'limite', l: 'Límite — qué NO puede hacer', tipo: 'textarea', ph: 'Qué queda explícitamente fuera de su autoridad' }
          ]} />
        <Hint style={{ marginTop: 8 }}>
          Los roles que declares acá aparecen como sugerencia al asignar el responsable de cada paso.
        </Hint>
      </Seccion>

      {/* ── 4. Transición ── */}
      <Seccion n="4" titulo="Estado de transición" editable={editable}
        sub="Sección 5 del SOP. Es la tabla que hace entendible el cambio para el equipo: cómo se opera hoy y cómo debe operarse."
        sucio={sucioTransicion} guardando={busy === 'prc_transicion'} onDescartar={reset}
        onGuardar={() => guardarLista('prc_transicion', transicion, orig.transicion, 'dimension', 'transición')}>
        <Lista editable={editable} filas={transicion} setFilas={setTransicion} etiquetaAgregar="Agregar dimensión"
          nuevo={() => ({ dimension: '', hoy: '', debe_ser: '' })}
          campos={[
            { k: 'dimension', l: 'Dimensión', ancho: '150px', ph: 'Ej: Cobro' },
            { k: 'hoy', l: 'Cómo funciona HOY', tipo: 'textarea', ph: 'La práctica actual, sin adornos' },
            { k: 'debe_ser', l: 'Cómo debe funcionar', tipo: 'textarea', ph: 'El estándar que instala este SOP' }
          ]} />
      </Seccion>

      {/* ── 5. Fases, pasos y errores ── */}
      <Seccion n="5" titulo="Fases, pasos y errores frecuentes" editable={editable}
        sub="Sección 6 del SOP y fuente del flujograma swimlane. Cada fase es una barra de color; cada paso, una caja."
        sucio={sucioFlujo} guardando={busy === 'flujo'} onGuardar={guardarFlujo} onDescartar={reset}>

        {/* selector de vista: formulario clásico o diseño sobre el diagrama */}
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', marginBottom: 13 }}>
          <div style={{ display: 'inline-flex', background: 'var(--bg-page)', borderRadius: 10, padding: 3, gap: 2 }}>
            {[
              { k: 'form', l: '📋 Formulario', t: 'Edición por fases desplegables, con errores frecuentes incluidos' },
              { k: 'diseno', l: '🗺️ Diseño sobre el flujograma', t: 'Edita haciendo clic directamente en las cajas del diagrama' }
            ].map(v => (
              <button key={v.k} onClick={() => cambiarVista(v.k)} title={v.t} style={{
                padding: '6px 13px', borderRadius: 8, fontSize: 12, fontWeight: 700, minHeight: 0,
                cursor: 'pointer', border: 'none',
                background: vistaFlujo === v.k ? 'var(--bg-surface)' : 'transparent',
                color: vistaFlujo === v.k ? 'var(--accent)' : 'var(--text-muted)',
                boxShadow: vistaFlujo === v.k ? '0 1px 3px rgba(0,0,0,.12)' : 'none'
              }}>{v.l}</button>
            ))}
          </div>
          <Hint style={{ marginTop: 0 }}>
            {vistaFlujo === 'diseno'
              ? 'Mismos datos, otra superficie: lo que cambies acá se guarda con el mismo botón "Guardar sección". Los errores frecuentes se editan en la vista Formulario.'
              : 'Las dos vistas editan lo mismo; usa la que te acomode.'}
          </Hint>
        </div>

        {vistaFlujo === 'diseno' && (
          <PrcDisenador proceso={proceso} fases={fases} pasos={pasos}
            setFases={setFases} setPasos={setPasos} editable={editable}
            listaRolesId={listaRoles} sistemasId={'sis-' + proceso.id} />
        )}

        {vistaFlujo === 'form' && (<>

        {fases.length === 0 && <Vacio ic="🗺️" txt="Sin fases. Agrega la primera para empezar a construir el flujo." />}

        {fases.map((f, fi) => {
          const abierta = faseAbierta === f.id
          const lista = pasosDe(f.id)
          const errs = errores.filter(e => e.fase_id === f.id)
          return (
            <div key={f.id} style={{
              border: '1px solid var(--border-2)', borderRadius: 12, marginBottom: 10, overflow: 'hidden',
              borderLeft: `4px solid ${f.color || '#334155'}`
            }}>
              <div style={{
                display: 'flex', gap: 9, alignItems: 'center', padding: '10px 12px',
                background: 'var(--bg-page)', flexWrap: 'wrap'
              }}>
                <button onClick={() => setFaseAbierta(abierta ? null : f.id)} title={abierta ? 'Cerrar esta fase' : 'Abrir para editar los pasos'}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, minHeight: 0, padding: 0, width: 18 }}>
                  {abierta ? '▾' : '▸'}
                </button>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text-muted)' }}>FASE {fi + 1}</span>
                <input disabled={!editable} placeholder="Nombre de la fase" value={f.nombre || ''}
                  onChange={e => setFases(p => p.map((x, j) => j === fi ? { ...x, nombre: e.target.value } : x))}
                  style={{ ...css.input, flex: 1, minWidth: 170, fontWeight: 600, padding: '6px 9px', fontSize: 12.5 }} />
                <Bd c="var(--text-muted)">{lista.length} pasos</Bd>
                {errs.length > 0 && <Bd c="var(--warning)">{errs.length} errores</Bd>}
                {editable && (
                  <span style={{ display: 'flex', gap: 3 }}>
                    <BtIc ic="↑" title="Subir la fase" dis={fi === 0} onClick={() => setFases(p => mover(p, fi, -1))} />
                    <BtIc ic="↓" title="Bajar la fase" dis={fi === fases.length - 1} onClick={() => setFases(p => mover(p, fi, 1))} />
                    <BtEliminar title="Eliminar la fase con todos sus pasos"
                      onConfirm={() => {
                        setFases(p => p.filter((_, j) => j !== fi))
                        setPasos(p => p.filter(x => x.fase_id !== f.id))
                        setErrores(p => p.filter(x => x.fase_id !== f.id))
                      }} />
                  </span>
                )}
              </div>

              {abierta && (
                <div style={{ padding: 13 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginBottom: 14 }}>
                    <Campo l="Responsable principal" hint="El cargo que lidera la fase.">
                      <input disabled={!editable} list={listaRoles} style={{ ...css.input, fontSize: 12.5, padding: '7px 9px' }}
                        value={f.responsable_principal || ''}
                        onChange={e => setFases(p => p.map((x, j) => j === fi ? { ...x, responsable_principal: e.target.value } : x))} />
                    </Campo>
                    <Campo l="Descripción de la fase" hint="Una línea que explique para qué existe.">
                      <input disabled={!editable} style={{ ...css.input, fontSize: 12.5, padding: '7px 9px' }} value={f.descripcion || ''}
                        onChange={e => setFases(p => p.map((x, j) => j === fi ? { ...x, descripcion: e.target.value } : x))} />
                    </Campo>
                    <Campo l="Color de la barra" hint="Color de la fase en el flujograma.">
                      <input type="color" disabled={!editable} value={f.color || '#334155'}
                        onChange={e => setFases(p => p.map((x, j) => j === fi ? { ...x, color: e.target.value } : x))}
                        style={{ ...css.input, height: 34, padding: 3, cursor: 'pointer' }} />
                    </Campo>
                  </div>

                  <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: .3, color: 'var(--text-muted)', marginBottom: 7 }}>
                    Pasos de la fase
                  </div>

                  {lista.length === 0 && <Vacio txt="Sin pasos en esta fase." />}

                  {lista.map((p, i) => (
                    <div key={p.id} style={{
                      border: '1px solid var(--border-1)', borderRadius: 10, padding: 10, marginBottom: 8,
                      background: p.es_control_critico ? 'var(--danger-bg)' : p.es_decision ? 'var(--warning-bg)' : 'var(--bg-surface)'
                    }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                        <Bd c="var(--text-secondary)">{fi + 1}.{i + 1}</Bd>
                        <input disabled={!editable} placeholder="Acción: qué se hace, en imperativo" value={p.accion || ''}
                          onChange={e => setPasoCampo(p.id, 'accion', e.target.value)}
                          style={{ ...css.input, flex: 1, minWidth: 200, fontSize: 12.5, padding: '7px 9px' }} />
                        {editable && (
                          <span style={{ display: 'flex', gap: 3 }}>
                            <BtIc ic="↑" title="Subir el paso" dis={i === 0} onClick={() => moverPaso(f.id, i, -1)} />
                            <BtIc ic="↓" title="Bajar el paso" dis={i === lista.length - 1} onClick={() => moverPaso(f.id, i, 1)} />
                            <BtEliminar title="Eliminar este paso" onConfirm={() => setPasos(prev => prev.filter(x => x.id !== p.id))} />
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                        <Campo l="Responsable" hint="Define el carril del flujograma.">
                          <input disabled={!editable} list={listaRoles} value={p.responsable || ''}
                            onChange={e => setPasoCampo(p.id, 'responsable', e.target.value)}
                            style={{ ...css.input, fontSize: 12.5, padding: '6px 9px' }} />
                        </Campo>
                        <Campo l="Sistema" hint="Dónde se ejecuta.">
                          <input disabled={!editable} list={'sis-' + proceso.id} value={p.sistema || ''}
                            onChange={e => setPasoCampo(p.id, 'sistema', e.target.value)}
                            style={{ ...css.input, fontSize: 12.5, padding: '6px 9px' }} />
                        </Campo>
                        <Campo l="Control / tiempo" hint="Ej: ≤ 24 h, obligatorio, diario.">
                          <input disabled={!editable} value={p.control_tiempo || ''}
                            onChange={e => setPasoCampo(p.id, 'control_tiempo', e.target.value)}
                            style={{ ...css.input, fontSize: 12.5, padding: '6px 9px' }} />
                        </Campo>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 17 }}>
                          <label style={{ fontSize: 11.5, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}
                            title="Se dibuja con borde rojo: si este paso falla, el proceso falla">
                            <input type="checkbox" disabled={!editable} checked={!!p.es_control_critico}
                              onChange={e => setPasoCampo(p.id, 'es_control_critico', e.target.checked)} /> Control crítico
                          </label>
                          <label style={{ fontSize: 11.5, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}
                            title="Se dibuja como rombo con dos salidas">
                            <input type="checkbox" disabled={!editable} checked={!!p.es_decision}
                              onChange={e => setPasoCampo(p.id, 'es_decision', e.target.checked)} /> Punto de decisión
                          </label>
                        </div>
                      </div>
                      {p.es_decision && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                          <Campo l="Si SÍ →" hint="Qué pasa cuando la respuesta es afirmativa.">
                            <input disabled={!editable} value={p.rama_si || ''} onChange={e => setPasoCampo(p.id, 'rama_si', e.target.value)}
                              style={{ ...css.input, fontSize: 12.5, padding: '6px 9px' }} />
                          </Campo>
                          <Campo l="Si NO →" hint="La ruta alternativa o de excepción.">
                            <input disabled={!editable} value={p.rama_no || ''} onChange={e => setPasoCampo(p.id, 'rama_no', e.target.value)}
                              style={{ ...css.input, fontSize: 12.5, padding: '6px 9px' }} />
                          </Campo>
                        </div>
                      )}
                    </div>
                  ))}

                  {editable && (
                    <Bt v="sec" sm onClick={() => agregarPaso(f.id)} title="Agrega un paso al final de esta fase">
                      ＋ Agregar paso a esta fase
                    </Bt>
                  )}

                  <div style={{ marginTop: 16, paddingTop: 13, borderTop: '1px dashed var(--border-2)' }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: .3, color: 'var(--text-muted)', marginBottom: 4 }}>
                      Errores frecuentes de la fase
                    </div>
                    <Hint style={{ marginBottom: 8 }}>
                      Lo que suele salir mal, qué provoca y cómo se previene. Es la sección que más sirve al capacitar.
                    </Hint>
                    {errs.map((e, i) => (
                      <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 34px', gap: 7, marginBottom: 7 }}>
                        <input disabled={!editable} placeholder="Error" value={e.error || ''}
                          onChange={ev => setErrores(p => p.map(x => x.id === e.id ? { ...x, error: ev.target.value } : x))}
                          style={{ ...css.input, fontSize: 12, padding: '6px 9px' }} />
                        <input disabled={!editable} placeholder="Consecuencia" value={e.consecuencia || ''}
                          onChange={ev => setErrores(p => p.map(x => x.id === e.id ? { ...x, consecuencia: ev.target.value } : x))}
                          style={{ ...css.input, fontSize: 12, padding: '6px 9px' }} />
                        <input disabled={!editable} placeholder="Prevención" value={e.prevencion || ''}
                          onChange={ev => setErrores(p => p.map(x => x.id === e.id ? { ...x, prevencion: ev.target.value } : x))}
                          style={{ ...css.input, fontSize: 12, padding: '6px 9px' }} />
                        {editable && <BtEliminar title="Quitar este error" onConfirm={() => setErrores(p => p.filter(x => x.id !== e.id))} />}
                      </div>
                    ))}
                    {editable && <Bt v="ghost" sm onClick={() => agregarError(f.id)} title="Agrega una fila de error frecuente">＋ Agregar error frecuente</Bt>}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {editable && (
          <Bt v="sec" onClick={agregarFase} style={{ marginTop: 6 }} title="Agrega una fase nueva al final del flujo">
            ＋ Agregar fase
          </Bt>
        )}

        </>)}

        <datalist id={'sis-' + proceso.id}>
          {cat.sistemas.map(s => <option key={s.codigo} value={s.etiqueta} />)}
        </datalist>
      </Seccion>

      {/* ── 6. KPI ── */}
      <Seccion n="6" titulo="Indicadores" editable={editable}
        sub="Sección 7 del SOP. Sin al menos un indicador medido, el proceso nunca llega a implementado."
        sucio={sucioKpis} guardando={busy === 'prc_kpis'} onDescartar={reset}
        onGuardar={() => guardarLista('prc_kpis', kpis, orig.kpis, 'indicador', 'indicadores')}>
        <Lista editable={editable} filas={kpis} setFilas={setKpis} etiquetaAgregar="Agregar indicador"
          nuevo={() => ({ indicador: '', definicion_operacional: '', meta: '', frecuencia: 'MENSUAL', responsable: '', es_kpi_ancla: false })}
          campos={[
            { k: 'indicador', l: 'Indicador', ancho: '160px', ph: 'Ej: OTIF' },
            { k: 'definicion_operacional', l: 'Definición operacional', tipo: 'textarea', ph: 'Cómo se calcula exactamente' },
            { k: 'meta', l: 'Meta', ancho: '110px', ph: '≥ 90%' },
            { k: 'frecuencia', l: 'Frecuencia', ancho: '125px', tipo: 'select', opts: FRECUENCIAS },
            { k: 'responsable', l: 'Responsable', ancho: '140px', lista: 'roles' },
            { k: 'es_kpi_ancla', l: 'Ancla', ancho: '74px', tipo: 'check', corto: 'Ancla' }
          ]} />
        <Hint style={{ marginTop: 8 }}>
          Marca como <b>ancla</b> el indicador principal, el que resume la salud del proceso.
        </Hint>
      </Seccion>

      <div style={{
        padding: '12px 16px', borderRadius: 12, background: 'var(--accent-bg)',
        color: 'var(--accent-text)', fontSize: 12.5, lineHeight: 1.6
      }}>
        <b>Cuando termines de editar:</b> anda a la pestaña <b>SOP</b> y aprieta “Guardar como nueva versión”.
        Eso genera el documento con el contenido actual, listo para revisar y firmar. El flujograma se redibuja solo
        con los cambios que hiciste en las fases y pasos.
      </div>
    </div>
  )
}
