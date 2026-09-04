// src/procesos/PrcConfig.jsx — catálogos, comités y reglas del módulo
import { useState } from 'react'
import { supabase } from '../supabase'
import { Cd, Bt, Bd, Tabs, Sheet, Campo, Chips, Hint, css, puedeAprobar } from './prcUI'

const SUB = [
  { k: 'comites',   l: 'Comités',   ic: '🤝' },
  { k: 'catalogos', l: 'Catálogos', ic: '🏷️' },
  { k: 'reglas',    l: 'Reglas',    ic: '🔒' }
]

export function PrcConfig({ cat, cu, onRecargar, toast }) {
  const [sub, setSub] = useState('comites')
  const [edit, setEdit] = useState({})
  const [busy, setBusy] = useState(false)
  const [reg, setReg] = useState(null)          // comité cuyo reglamento se edita
  const admin = puedeAprobar(cu)

  const guardarComite = async (c) => {
    const cambios = edit[c.codigo]
    if (!cambios) return
    setBusy(true)
    const { error } = await supabase.from('prc_comites').update(cambios).eq('codigo', c.codigo)
    setBusy(false)
    if (error) return toast('Error al guardar: ' + error.message, 'err')
    setEdit(e => ({ ...e, [c.codigo]: undefined }))
    toast(`${c.nombre} actualizado`); onRecargar()
  }

  const guardarReglamento = async () => {
    setBusy(true)
    const { error } = await supabase.from('prc_comites').update({
      proposito: reg.proposito || null, facultades: reg.facultades || null, limites: reg.limites || null,
      secretario: reg.secretario || null, integrantes: reg.integrantes || [],
      quorum_min: reg.quorum_min === '' || reg.quorum_min == null ? 0.75 : Math.min(1, Math.max(0.5, Number(reg.quorum_min) / 100)),
      integrantes_min: reg.integrantes_min === '' || reg.integrantes_min == null ? 3 : +reg.integrantes_min,
      duracion_min: +reg.duracion_min || 60, duracion_max: +reg.duracion_max || 180, reporta_a: reg.reporta_a || null
    }).eq('codigo', reg.codigo)
    setBusy(false)
    if (error) return toast('Error al guardar el reglamento: ' + error.message, 'err')
    setReg(null); toast(`Reglamento de ${reg.nombre} guardado`); onRecargar()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <Tabs sm tabs={SUB} val={sub} onChange={setSub} />

      {sub === 'comites' && (
        <Cd style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--border-1)', fontSize: 12, color: 'var(--text-muted)' }}>
            Los códigos de comité son la llave de vinculación con la app de Proyectos. Si allá los definieron con
            otro código, cámbialos aquí para que ambos módulos hablen del mismo comité.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={css.th}>Código</th><th style={css.th}>Nombre</th><th style={css.th}>Periodicidad</th>
              <th style={css.th}>Responsable</th><th style={css.th}>Dirección</th><th style={css.th}></th>
            </tr></thead>
            <tbody>{cat.comites.map(c => {
              const e = edit[c.codigo] || {}
              const val = k => (e[k] !== undefined ? e[k] : c[k]) ?? ''
              const set = (k, v) => setEdit(o => ({ ...o, [c.codigo]: { ...(o[c.codigo] || {}), [k]: v } }))
              return (
                <tr key={c.codigo}>
                  <td style={{ ...css.td, fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{c.codigo}</td>
                  <td style={css.td}>
                    {admin ? <input style={{ ...css.input, padding: '5px 8px' }} value={val('nombre')} onChange={ev => set('nombre', ev.target.value)} /> : c.nombre}
                  </td>
                  <td style={css.td}>
                    {admin ? (
                      <select style={{ ...css.select, fontSize: 12 }} value={val('periodicidad')} onChange={ev => set('periodicidad', ev.target.value)}>
                        {['SEMANAL', 'QUINCENAL', 'MENSUAL', 'TRIMESTRAL'].map(x => <option key={x}>{x}</option>)}
                      </select>
                    ) : c.periodicidad}
                  </td>
                  <td style={css.td}>
                    {admin ? <input style={{ ...css.input, padding: '5px 8px' }} value={val('responsable')} onChange={ev => set('responsable', ev.target.value)} /> : c.responsable}
                  </td>
                  <td style={css.td}>{(cat.direcciones.find(d => d.codigo === c.direccion) || {}).etiqueta || c.direccion}</td>
                  <td style={{ ...css.td, whiteSpace: 'nowrap' }}>
                    {admin && edit[c.codigo] && <Bt sm dis={busy} onClick={() => guardarComite(c)}>Guardar</Bt>}{' '}
                    <Bt v="sec" sm onClick={() => setReg({ ...c, quorum_min: Math.round((c.quorum_min ?? 0.75) * 100), integrantes_min: c.integrantes_min ?? 3, duracion_min: c.duracion_min ?? 60, duracion_max: c.duracion_max ?? 180, integrantes: c.integrantes || [] })}
                      title="Propósito, facultades, límites, integrantes, quórum y a quién reporta">Reglamento</Bt>
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
        </Cd>
      )}

      {sub === 'catalogos' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 13 }}>
          <Catalogo t="Categorías" filas={cat.categorias.map(c => [c.codigo, c.nombre, c.descripcion, c.color])} cols={['Código', 'Nombre', 'Descripción']} />
          <Catalogo t="Ondas de implementación" filas={cat.ondas.map(o => [o.codigo, o.nombre, o.ventana])} cols={['Código', 'Nombre', 'Ventana']} />
          <Catalogo t="Estados de documento" filas={cat.estadosDoc.map(e => [e.codigo, e.etiqueta, e.significado, e.color])} cols={['Código', 'Etiqueta', 'Significado']} />
          <Catalogo t="Estados de implementación" filas={cat.estadosImpl.map(e => [e.codigo, e.etiqueta, e.criterio, e.color])} cols={['Código', 'Etiqueta', 'Criterio de entrada']} />
          <Catalogo t="Direcciones responsables" filas={cat.direcciones.map(d => [d.codigo, d.etiqueta, d.titular, d.color])} cols={['Código', 'Dirección', 'Titular']} />
          <Catalogo t="Sistemas" filas={cat.sistemas.map(s => [s.codigo, s.etiqueta, '', s.color])} cols={['Código', 'Sistema', '']} />
        </div>
      )}

      {sub === 'reglas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <Cd>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Reglas codificadas en la base de datos</div>
            <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              Estas reglas no son convenciones de uso: están implementadas como restricciones y disparadores en
              Supabase. Ni la app ni una consulta manual pueden saltárselas.
            </p>
            <ul style={{ fontSize: 12.5, lineHeight: 1.8, margin: '10px 0 0 18px' }}>
              <li><b>Score calculado.</b> <code>score = impacto × urgencia</code> es una columna generada. No se escribe a mano.</li>
              <li><b>Implementado bloqueado.</b> Marcar un proceso como IMPLEMENTADO sin SOP aprobado y vigente, flujograma vigente, capacitación registrada y al menos una medición de KPI falla con error de base de datos.</li>
              <li><b>Una sola versión vigente.</b> Un índice único impide que existan dos documentos vigentes del mismo tipo para el mismo proceso.</li>
              <li><b>Aprobar es firmar.</b> Al registrar una firma de aprobación, el documento pasa a VIGENTE, la versión anterior se deroga, el proceso actualiza su estado y se agenda la próxima revisión.</li>
              <li><b>Días de atraso.</b> Se calculan en la vista contra la fecha objetivo vigente; no se almacenan para que no queden desactualizados.</li>
              <li><b>Semáforo rojo.</b> Score ≥ 6, estado PENDIENTE y más de 30 días de atraso.</li>
              <li><b>Sin quórum no hay decisiones.</b> Registrar una decisión en una sesión cerrada SIN_QUORUM o anulada falla con error (P21, principio 4).</li>
              <li><b>Piloto de 2 semanas.</b> Un comité de trabajo no acepta fechas de piloto con menos de 14 días (P21, principio 10).</li>
              <li><b>Plazo de 2 meses.</b> Todo encargo nace con fecha límite a 2 meses y sus 7 fases con fecha meta (P21, principio 11).</li>
              <li><b>Correlativo de sesión.</b> Cada sesión recibe su número por comité al crearse; el acta se codifica ACTA-comité-N°.</li>
              <li><b>Cierre con fecha.</b> Al cerrar un acuerdo se fija la fecha de cierre, que permite medir el cumplimiento a plazo.</li>
            </ul>
          </Cd>
          <Cd>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Definición de implementado</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
              {[
                ['1. SOP aprobado', 'Documento tipo SOP vigente con aprobador registrado y firma en el timeline.'],
                ['2. Flujograma vigente', 'Documento tipo FLUJOGRAMA vigente publicado en el repositorio.'],
                ['3. Capacitación ejecutada', 'Al menos un registro con listado de asistentes.'],
                ['4. Ciclo de KPI cerrado', 'Al menos una medición del indicador principal registrada.']
              ].map(([t, d]) => (
                <div key={t} style={{ padding: 12, borderRadius: 11, background: 'var(--bg-page)' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>{t}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>{d}</div>
                </div>
              ))}
            </div>
          </Cd>
          <Cd>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Estructura del SOP V2.0</div>
            <ol style={{ fontSize: 12.5, lineHeight: 1.8, margin: '6px 0 0 18px' }}>
              <li>Objetivo con especificidad operativa</li>
              <li>Alcance explícito por sucursal y excepciones</li>
              <li>Principios operativos + caja de <b>REGLA CRÍTICA</b></li>
              <li>Tabla de roles: rol · función en este proceso · límite</li>
              <li>Estado de transición: cómo funciona hoy vs. cómo debe funcionar</li>
              <li>Flujo por fases: pasos, reglas y errores frecuentes</li>
              <li>KPIs: indicador · definición · meta · frecuencia · responsable</li>
              <li>Relación con otros procesos</li>
            </ol>
          </Cd>
        </div>
      )}

      <Sheet open={!!reg} onClose={() => setReg(null)} title={`Reglamento · ${reg?.nombre || ''}`} ancho={700}>
        {reg && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <Campo l="Propósito" hint="Para qué existe este comité (terms of reference)."><textarea rows={2} disabled={!admin} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} value={reg.proposito || ''} onChange={e => setReg({ ...reg, proposito: e.target.value })} /></Campo>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
              <Campo l="Facultades (qué decide)"><textarea rows={3} disabled={!admin} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} value={reg.facultades || ''} onChange={e => setReg({ ...reg, facultades: e.target.value })} placeholder="Ej: aprueba SOP de su área, asigna comités de trabajo, fija metas de sus indicadores" /></Campo>
              <Campo l="Límites (qué NO decide)"><textarea rows={3} disabled={!admin} style={{ ...css.input, resize: 'vertical', fontFamily: 'inherit' }} value={reg.limites || ''} onChange={e => setReg({ ...reg, limites: e.target.value })} /></Campo>
            </div>
            <Campo l="Integrantes permanentes" hint="Se sugieren al convocar. Impar, mínimo 3, al menos uno de otra dirección (principios 5 y 7).">
              <Chips valores={reg.integrantes || []} onChange={v => setReg({ ...reg, integrantes: v })} editable={admin} ph="Nombre o cargo — escribe y Enter" />
              <Hint>{(reg.integrantes || []).length} integrante(s){(reg.integrantes || []).length >= 3 && (reg.integrantes || []).length % 2 === 1 ? ' · impar ✓' : (reg.integrantes || []).length ? ' · debe ser impar ≥ 3' : ''}</Hint>
            </Campo>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9 }}>
              <Campo l="Secretario/a de actas"><input disabled={!admin} style={css.input} value={reg.secretario || ''} onChange={e => setReg({ ...reg, secretario: e.target.value })} /></Campo>
              <Campo l="Quórum (% de votantes)" hint="Principio 4: ¾ = 75%."><input type="number" min="50" max="100" disabled={!admin} style={css.input} value={reg.quorum_min ?? 75} onChange={e => setReg({ ...reg, quorum_min: e.target.value })} /></Campo>
              <Campo l="Mínimo de votantes presentes"><input type="number" min="1" disabled={!admin} style={css.input} value={reg.integrantes_min ?? 3} onChange={e => setReg({ ...reg, integrantes_min: e.target.value })} /></Campo>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 9 }}>
              <Campo l="Duración mínima (min)"><input type="number" disabled={!admin} style={css.input} value={reg.duracion_min ?? 60} onChange={e => setReg({ ...reg, duracion_min: e.target.value })} /></Campo>
              <Campo l="Duración máxima (min)"><input type="number" disabled={!admin} style={css.input} value={reg.duracion_max ?? 180} onChange={e => setReg({ ...reg, duracion_max: e.target.value })} /></Campo>
              <Campo l="Reporta a" hint="A dónde escala lo que no resuelve."><select disabled={!admin} style={{ ...css.input, cursor: 'pointer' }} value={reg.reporta_a || ''} onChange={e => setReg({ ...reg, reporta_a: e.target.value })}>
                <option value="">— (no escala)</option>{cat.comites.filter(x => x.codigo !== reg.codigo).map(x => <option key={x.codigo} value={x.codigo}>{x.nombre}</option>)}</select></Campo>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Bt v="sec" onClick={() => setReg(null)}>Cerrar</Bt>
              {admin && <Bt dis={busy} onClick={guardarReglamento}>{busy ? 'Guardando…' : 'Guardar reglamento'}</Bt>}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}

function Catalogo({ t, cols, filas }) {
  return (
    <Cd style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--border-1)', fontSize: 13, fontWeight: 700 }}>{t}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{cols.map(c => <th key={c} style={css.th}>{c}</th>)}</tr></thead>
        <tbody>{filas.map((f, i) => (
          <tr key={i}>
            <td style={{ ...css.td, fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>
              {f[3] && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: f[3], marginRight: 6 }} />}
              {f[0]}
            </td>
            <td style={{ ...css.td, fontWeight: 600 }}>{f[1]}</td>
            <td style={{ ...css.td, color: 'var(--text-muted)' }}>{f[2]}</td>
          </tr>
        ))}</tbody>
      </table>
    </Cd>
  )
}
