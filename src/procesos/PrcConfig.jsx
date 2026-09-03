// src/procesos/PrcConfig.jsx — catálogos, comités y reglas del módulo
import { useState } from 'react'
import { supabase } from '../supabase'
import { Cd, Bt, Bd, Tabs, css, puedeAprobar } from './prcUI'

const SUB = [
  { k: 'comites',   l: 'Comités',   ic: '🤝' },
  { k: 'catalogos', l: 'Catálogos', ic: '🏷️' },
  { k: 'reglas',    l: 'Reglas',    ic: '🔒' }
]

export function PrcConfig({ cat, cu, onRecargar, toast }) {
  const [sub, setSub] = useState('comites')
  const [edit, setEdit] = useState({})
  const [busy, setBusy] = useState(false)
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
                  <td style={css.td}>
                    {admin && edit[c.codigo] && <Bt sm dis={busy} onClick={() => guardarComite(c)}>Guardar</Bt>}
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
