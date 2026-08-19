// src/procesos/PrcDisenador.jsx
// Diseño del flujograma SOBRE el diagrama: el swimlane en vivo es la superficie
// de edición. Clic en una caja o en una barra de fase para seleccionarla y
// editarla en el panel lateral; el diagrama se redibuja con cada cambio.
// Opera sobre el mismo estado local del editor (fases/pasos): guardar es el
// mismo botón "Guardar sección" de la sección 5.

import { useState, useMemo, useRef } from 'react'
import { flujoSVG } from './prcFlujo'
import { Cd, Bt, Bd, Campo, Hint, BtIc, BtEliminar, Vacio, css, uid } from './prcUI'

const mover = (arr, i, delta) => {
  const j = i + delta
  if (j < 0 || j >= arr.length) return arr
  const copia = [...arr]
  ;[copia[i], copia[j]] = [copia[j], copia[i]]
  return copia
}

export function PrcDisenador({ proceso, fases, pasos, setFases, setPasos, editable, listaRolesId, sistemasId }) {
  const [sel, setSel] = useState(null)          // { tipo: 'paso'|'fase', id }
  const [zoom, setZoom] = useState(0.62)
  const boxRef = useRef(null)

  /* ── normalización: orden = posición actual en pantalla ─────────────────── */
  const fasesN = useMemo(() => fases.map((f, i) => ({ ...f, orden: i + 1 })), [fases])
  const pasosDe = faseId => pasos.filter(p => p.fase_id === faseId)

  const { pasosN, ghosts } = useMemo(() => {
    const out = []
    const gh = new Set()
    fasesN.forEach(f => {
      const lista = pasosDe(f.id)
      if (!lista.length) {
        const gid = 'GHOST-' + f.id
        gh.add(gid)
        out.push({
          id: gid, fase_id: f.id, orden: 1,
          accion: '( fase vacía — clic aquí y agrega su primer paso )',
          responsable: f.responsable_principal || 'Sin asignar',
          sistema: '', control_tiempo: '', es_control_critico: false, es_decision: false
        })
      } else {
        lista.forEach((p, i) => out.push({ ...p, orden: i + 1 }))
      }
    })
    return { pasosN: out, ghosts: gh }
  }, [fasesN, pasos])

  const svg = useMemo(() => flujoSVG(proceso, fasesN, pasosN, {
    interactivo: true,
    selId: sel?.tipo === 'paso' ? sel.id : null,
    selFase: sel?.tipo === 'fase' ? sel.id : null,
    version: 'Diseño en vivo', fecha: ''
  }), [proceso, fasesN, pasosN, sel])

  /* ── selección por clic sobre el SVG ─────────────────────────────────────── */
  const onClickSvg = (e) => {
    const gp = e.target.closest('[data-paso]')
    if (gp) {
      const id = gp.getAttribute('data-paso')
      if (ghosts.has(id)) setSel({ tipo: 'fase', id: id.replace('GHOST-', '') })
      else setSel({ tipo: 'paso', id })
      return
    }
    const gf = e.target.closest('[data-fase]')
    if (gf) { setSel({ tipo: 'fase', id: gf.getAttribute('data-fase') }); return }
    setSel(null)
  }

  /* ── mutaciones (mismo estado del editor) ────────────────────────────────── */
  const setPaso = (id, k, v) => setPasos(prev => prev.map(x => x.id === id ? { ...x, [k]: v } : x))
  const setFase = (id, k, v) => setFases(prev => prev.map(x => x.id === id ? { ...x, [k]: v } : x))

  const moverPaso = (p, delta) => {
    const lista = pasosDe(p.fase_id)
    const i = lista.findIndex(x => x.id === p.id)
    const movida = mover(lista, i, delta)
    if (movida === lista) return
    setPasos(prev => [...prev.filter(x => x.fase_id !== p.fase_id), ...movida])
  }

  const moverPasoAFase = (p, faseId) => {
    if (!faseId || faseId === p.fase_id) return
    setPasos(prev => prev.map(x => x.id === p.id ? { ...x, fase_id: faseId } : x))
  }

  const insertarDespues = (p) => {
    const nuevoPaso = {
      id: 'NUEVO-' + uid(), fase_id: p.fase_id, proceso_id: proceso.id,
      accion: '', responsable: p.responsable || '', sistema: '', control_tiempo: '',
      es_control_critico: false, es_decision: false, rama_si: '', rama_no: ''
    }
    setPasos(prev => {
      const i = prev.findIndex(x => x.id === p.id)
      const copia = [...prev]
      copia.splice(i + 1, 0, nuevoPaso)
      return copia
    })
    setSel({ tipo: 'paso', id: nuevoPaso.id })
  }

  const agregarPasoAFase = (faseId) => {
    const f = fases.find(x => x.id === faseId)
    const nuevoPaso = {
      id: 'NUEVO-' + uid(), fase_id: faseId, proceso_id: proceso.id,
      accion: '', responsable: f?.responsable_principal || '', sistema: '', control_tiempo: '',
      es_control_critico: false, es_decision: false, rama_si: '', rama_no: ''
    }
    setPasos(prev => [...prev, nuevoPaso])
    setSel({ tipo: 'paso', id: nuevoPaso.id })
  }

  const eliminarPaso = (id) => { setPasos(prev => prev.filter(x => x.id !== id)); setSel(null) }

  const moverFase = (id, delta) => {
    const i = fases.findIndex(x => x.id === id)
    setFases(prev => mover(prev, i, delta))
  }

  const agregarFase = () => {
    const id = 'NUEVO-' + uid()
    setFases(prev => [...prev, {
      id, proceso_id: proceso.id, nombre: 'Nueva fase', responsable_principal: '',
      descripcion: '', color: '#334155', orden: prev.length + 1
    }])
    setSel({ tipo: 'fase', id })
  }

  const eliminarFase = (id) => {
    setFases(prev => prev.filter(x => x.id !== id))
    setPasos(prev => prev.filter(x => x.fase_id !== id))
    setSel(null)
  }

  const pasoSel = sel?.tipo === 'paso' ? pasos.find(x => x.id === sel.id) : null
  const faseSel = sel?.tipo === 'fase' ? fases.find(x => x.id === sel.id) : null
  const inp = { ...css.input, fontSize: 12.5, padding: '7px 9px' }

  return (
    <div>
      {/* ── barra del lienzo ── */}
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', marginBottom: 9 }}>
        <Bd c="var(--accent)">{fases.length} fases</Bd>
        <Bd c="var(--text-muted)">{pasos.length} pasos</Bd>
        <Hint style={{ marginTop: 0 }}>Haz clic en una caja para editarla, o en una barra de color para editar su fase.</Hint>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <BtIc ic="−" title="Alejar" onClick={() => setZoom(z => Math.max(0.3, +(z - 0.08).toFixed(2)))} />
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', minWidth: 38, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <BtIc ic="＋" title="Acercar" onClick={() => setZoom(z => Math.min(1.4, +(z + 0.08).toFixed(2)))} />
          {editable && <Bt v="sec" sm onClick={agregarFase} title="Agrega una fase nueva al final del flujo">＋ Fase</Bt>}
        </div>
      </div>

      {/* ── lienzo ── */}
      <div ref={boxRef} onClick={onClickSvg} style={{
        overflow: 'auto', background: 'var(--bg-page)', borderRadius: 12,
        border: '1px solid var(--border-2)', padding: 12, maxHeight: '46vh'
      }}>
        {fases.length === 0
          ? <Vacio ic="🗺️" txt="Sin fases todavía. Usa ＋ Fase para partir: cada fase es una barra de color y sus pasos aparecen como cajas." />
          : <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: 'max-content' }}
              dangerouslySetInnerHTML={{ __html: svg }} />}
      </div>

      {/* ── panel de selección ── */}
      <div style={{ marginTop: 11 }}>
        {!sel && (
          <div style={{ padding: '11px 14px', borderRadius: 10, background: 'var(--bg-page)', fontSize: 12.5, color: 'var(--text-muted)' }}>
            Nada seleccionado. <b>Clic en una caja</b> del diagrama para editar ese paso —texto, responsable,
            controles, ramas— o <b>clic en una barra de fase</b> para renombrarla, moverla o agregarle pasos.
            El responsable define el carril: cámbialo y la caja salta de carril sola.
          </div>
        )}

        {pasoSel && (
          <Cd accent="var(--accent)" style={{ padding: 14 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <Bd c="var(--accent)">Paso seleccionado</Bd>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Fase: {fases.find(f => f.id === pasoSel.fase_id)?.nombre || '—'}
              </span>
              {editable && (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
                  <BtIc ic="←" title="Mover un lugar antes dentro de su fase" onClick={() => moverPaso(pasoSel, -1)} />
                  <BtIc ic="→" title="Mover un lugar después dentro de su fase" onClick={() => moverPaso(pasoSel, 1)} />
                  <select title="Mover el paso a otra fase" style={{ ...css.select, fontSize: 11.5, padding: '4px 7px' }}
                    value={pasoSel.fase_id} onChange={e => moverPasoAFase(pasoSel, e.target.value)}>
                    {fasesN.map((f, i) => <option key={f.id} value={f.id}>Fase {i + 1}: {f.nombre || 'sin nombre'}</option>)}
                  </select>
                  <Bt v="sec" sm onClick={() => insertarDespues(pasoSel)} title="Crea un paso nuevo justo después de este">＋ Insertar después</Bt>
                  <BtEliminar title="Eliminar este paso" onConfirm={() => eliminarPaso(pasoSel.id)} />
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 9 }}>
              <Campo l="Acción" obligatorio hint="Qué se hace, en imperativo. Es el texto de la caja.">
                <textarea rows={2} disabled={!editable} value={pasoSel.accion || ''}
                  onChange={e => setPaso(pasoSel.id, 'accion', e.target.value)}
                  style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
              </Campo>
              <Campo l="Responsable" hint="Define el carril.">
                <input disabled={!editable} list={listaRolesId} value={pasoSel.responsable || ''}
                  onChange={e => setPaso(pasoSel.id, 'responsable', e.target.value)} style={inp} />
              </Campo>
              <Campo l="Sistema" hint="Dónde se ejecuta.">
                <input disabled={!editable} list={sistemasId} value={pasoSel.sistema || ''}
                  onChange={e => setPaso(pasoSel.id, 'sistema', e.target.value)} style={inp} />
              </Campo>
              <Campo l="Control / tiempo" hint="Ej: ≤ 24 h, diario.">
                <input disabled={!editable} value={pasoSel.control_tiempo || ''}
                  onChange={e => setPaso(pasoSel.id, 'control_tiempo', e.target.value)} style={inp} />
              </Campo>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 9, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ fontSize: 12, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}
                title="Borde rojo en el diagrama: si este paso falla, el proceso falla">
                <input type="checkbox" disabled={!editable} checked={!!pasoSel.es_control_critico}
                  onChange={e => setPaso(pasoSel.id, 'es_control_critico', e.target.checked)} /> Control crítico
              </label>
              <label style={{ fontSize: 12, display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}
                title="Rombo con dos salidas: Sí y No">
                <input type="checkbox" disabled={!editable} checked={!!pasoSel.es_decision}
                  onChange={e => setPaso(pasoSel.id, 'es_decision', e.target.checked)} /> Punto de decisión
              </label>
              {pasoSel.es_decision && (
                <span style={{ display: 'flex', gap: 8, flex: 1, minWidth: 300 }}>
                  <input disabled={!editable} placeholder="Si SÍ →" value={pasoSel.rama_si || ''}
                    onChange={e => setPaso(pasoSel.id, 'rama_si', e.target.value)} style={{ ...inp, flex: 1 }} />
                  <input disabled={!editable} placeholder="Si NO →" value={pasoSel.rama_no || ''}
                    onChange={e => setPaso(pasoSel.id, 'rama_no', e.target.value)} style={{ ...inp, flex: 1 }} />
                </span>
              )}
            </div>
          </Cd>
        )}

        {faseSel && (
          <Cd accent={faseSel.color || '#334155'} style={{ padding: 14 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <Bd c="var(--accent)">Fase seleccionada</Bd>
              <Bd c="var(--text-muted)">{pasosDe(faseSel.id).length} pasos</Bd>
              {editable && (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
                  <BtIc ic="←" title="Mover la fase una posición antes" onClick={() => moverFase(faseSel.id, -1)} />
                  <BtIc ic="→" title="Mover la fase una posición después" onClick={() => moverFase(faseSel.id, 1)} />
                  <Bt v="sec" sm onClick={() => agregarPasoAFase(faseSel.id)} title="Agrega un paso al final de esta fase">＋ Paso</Bt>
                  <BtEliminar title="Eliminar la fase con todos sus pasos" onConfirm={() => eliminarFase(faseSel.id)} />
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 90px', gap: 9 }}>
              <Campo l="Nombre de la fase" obligatorio hint="El texto de la barra de color.">
                <input disabled={!editable} value={faseSel.nombre || ''}
                  onChange={e => setFase(faseSel.id, 'nombre', e.target.value)} style={inp} />
              </Campo>
              <Campo l="Responsable principal" hint="Se sugiere al crear pasos aquí.">
                <input disabled={!editable} list={listaRolesId} value={faseSel.responsable_principal || ''}
                  onChange={e => setFase(faseSel.id, 'responsable_principal', e.target.value)} style={inp} />
              </Campo>
              <Campo l="Color" hint="De la barra.">
                <input type="color" disabled={!editable} value={faseSel.color || '#334155'}
                  onChange={e => setFase(faseSel.id, 'color', e.target.value)}
                  style={{ ...inp, height: 34, padding: 3, cursor: 'pointer' }} />
              </Campo>
            </div>
            <div style={{ marginTop: 9 }}>
              <Campo l="Descripción" hint="Una línea: para qué existe la fase. Sale en el SOP.">
                <input disabled={!editable} value={faseSel.descripcion || ''}
                  onChange={e => setFase(faseSel.id, 'descripcion', e.target.value)} style={inp} />
              </Campo>
            </div>
          </Cd>
        )}
      </div>
    </div>
  )
}
