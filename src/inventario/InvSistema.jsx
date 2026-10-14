/* Sistema — salud de la fuente de datos y política de inventario por tipo. */

import { useState, useEffect } from 'react'
import {
  Kpi, Panel, Boton, inputEstilo, Cargando, ErrorBox, fN,
  INK, SLATE, LINE, PAPER, NAVY, ROJO, VERDE, AMBAR,
} from './invUI'
import {
  fetchSalud, fetchPoliticas, guardarPolitica, recalcularKpi,
  fetchConfig, guardarConfig, validarPolitica, CONFIG_DEFECTO,
} from './invData'

const ETIQUETAS = {
  ventas_dia_ultima_fecha: 'Última venta cargada',
  stock_ultimo_snapshot: 'Último inventario',
  ventas_dia_filas: 'Filas de venta diaria',
  skus_maestro: 'SKU en el maestro',
  skus_stock_sin_costo: 'SKU con stock sin costo',
  syncs_colgados: 'Sincronizaciones colgadas',
  ultimo_sync_ok: 'Última sincronización correcta',
  rebuild_lotes_pendientes: 'Lotes de reconstrucción pendientes',
  rebuild_lotes_error: 'Lotes con error',
  rebuild_lotes_ok: 'Lotes completados',
}

export function InvSistema({ usuario, onConfigCambiada }) {
  const [salud, setSalud] = useState({})
  const [pol, setPol] = useState([])
  const [cargando, setCargando] = useState(true)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState(null)      // { tipo, lead, cob }
  const [guardando, setGuardando] = useState(false)
  const [recalc, setRecalc] = useState('')
  const [cfg, setCfg] = useState(CONFIG_DEFECTO)
  const [cfgEdit, setCfgEdit] = useState(null)
  const [msgCfg, setMsgCfg] = useState('')

  const cargar = async () => {
    setCargando(true); setErr('')
    try {
      const [s, p, c] = await Promise.all([fetchSalud(), fetchPoliticas(), fetchConfig()])
      setCfg(c)
      setSalud(s); setPol(p)
    } catch (e) { setErr(e.message) }
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  const guardar = async () => {
    if (!edit) return
    setGuardando(true)
    try {
      await guardarPolitica(edit.tipo, {
        lead_time_dias: Number(edit.lead) || 14,
        cobertura_obj: Number(edit.cob) || 60,
      })
      setEdit(null); await cargar()
    } catch (e) { setErr(e.message) }
    setGuardando(false)
  }

  const recalcular = async () => {
    setRecalc('recalculando…')
    try { await recalcularKpi(); setRecalc('listo: recarga la app para ver los cambios'); await cargar() }
    catch (e) { setRecalc('error: ' + e.message) }
  }

  const CAMPOS_CFG = [
    { k: 'dias_activo',           l: 'Activo hasta',            u: 'días', d: 'Sin moverse hasta aquí, el producto está activo.' },
    { k: 'dias_lento',            l: 'Lento hasta',             u: 'días', d: 'Pasado esto es inmovilizado y abre alerta.' },
    { k: 'dias_inmovilizado',     l: 'Inmovilizado hasta',      u: 'días', d: 'Pasado esto se considera muerto.' },
    { k: 'dias_reposicion_sala',  l: 'Ciclo de reposición CD→sala', u: 'días', d: 'Lo mínimo que una posición debe poder guardar.' },
    { k: 'factor_sobredimension', l: 'Posición sobredimensionada', u: 'veces', d: 'Capacidad sobre N veces el máximo a guardar.' },
    { k: 'factor_desbalance',     l: 'Capital mal asignado',    u: 'veces', d: '% inventario sobre N veces el % de margen.' },
  ]
  const guardarCfg = async () => {
    const v = Object.fromEntries(CAMPOS_CFG.map(c => [c.k, Number(cfgEdit[c.k])]))
    if (!(v.dias_activo < v.dias_lento && v.dias_lento < v.dias_inmovilizado)) { setMsgCfg('Los días deben ir de menor a mayor: activo < lento < inmovilizado.'); return }
    if (!(v.factor_sobredimension > 1 && v.factor_desbalance > 1)) { setMsgCfg('Los factores deben ser mayores que 1.'); return }
    if (!(v.dias_reposicion_sala > 0)) { setMsgCfg('El ciclo de reposición debe ser mayor que 0.'); return }
    try {
      await guardarConfig(v, usuario); setCfgEdit(null); setMsgCfg('Guardado. Las alertas nuevas se abren con estos umbrales desde el próximo recálculo.')
      await cargar(); onConfigCambiada?.()
    } catch (e) { setMsgCfg('No se pudo guardar: ' + e.message) }
  }
  const alternarValidacion = async p => {
    try { await validarPolitica(p.tipo_producto, !p.validado, usuario); await cargar() }
    catch (e) { setErr(e.message) }
  }

  if (cargando) return <Cargando />

  const hoy = new Date().toISOString().slice(0, 10)
  const ventaFresca = salud.ventas_dia_ultima_fecha >= new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
  const stockFresco = salud.stock_ultimo_snapshot === hoy
  const pendientes = +salud.rebuild_lotes_pendientes || 0
  const errores = +salud.rebuild_lotes_error || 0

  return (
    <div>
      {err && <ErrorBox>{err}</ErrorBox>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
        <Kpi label="Última venta cargada" valor={salud.ventas_dia_ultima_fecha || '—'}
             sub={ventaFresca ? 'al día' : 'atrasada'} color={ventaFresca ? VERDE : ROJO} alerta={!ventaFresca} />
        <Kpi label="Último inventario" valor={salud.stock_ultimo_snapshot || '—'}
             sub={stockFresco ? 'de hoy' : 'atrasado'} color={stockFresco ? VERDE : AMBAR} alerta={!stockFresco} />
        <Kpi label="Indicadores calculados" valor={salud.kpi_actualizado || '—'}
             sub={`historia desde ${salud.historia_desde || '—'}`} color={NAVY} />
        <Kpi label="SKU en el maestro" valor={fN(salud.skus_maestro)} color={NAVY} />
        <Kpi label="Stock sin costo" valor={fN(salud.skus_stock_sin_costo)}
             sub="no se pueden valorizar" color={+salud.skus_stock_sin_costo > 0 ? ROJO : VERDE}
             alerta={+salud.skus_stock_sin_costo > 0} />
        <Kpi label="Sincronizaciones colgadas" valor={fN(salud.syncs_colgados)}
             color={+salud.syncs_colgados > 0 ? ROJO : VERDE} alerta={+salud.syncs_colgados > 0} />
        <Kpi label="Reconstrucción" valor={pendientes > 0 ? `${pendientes} pend.` : 'completa'}
             sub={errores > 0 ? `${errores} con error` : `${fN(salud.rebuild_lotes_ok)} lotes ok`}
             color={pendientes > 0 || errores > 0 ? AMBAR : VERDE} alerta={errores > 0} />
      </div>

      <Panel titulo="Sincronización automática"
             sub="cuatro tareas nocturnas, sin intervención manual"
             accion={<Boton onClick={cargar}>Actualizar</Boton>}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <tbody>
            {[
              ['01:30', 'Inventario de todas las ubicaciones'],
              ['02:00', 'Ventas de los últimos 5 días'],
              ['Día 2 del mes', 'Barrido profundo del mes anterior (recaptura anulaciones y notas de crédito)'],
              ['02:40', 'Recálculo de todos los indicadores (demanda, cobertura, reposición)'],
              ['Domingos 01:40', 'Maestro de productos desde BSALE'],
            ].map(([hora, que]) => (
              <tr key={hora} style={{ borderBottom: `1px solid ${LINE}` }}>
                <td style={{ padding: '6px 9px', fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>{hora}</td>
                <td style={{ padding: '6px 9px', color: SLATE }}>{que}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel titulo="Reglas de antigüedad y espacio" sub="umbrales con que se clasifican los productos y las posiciones de bodega"
             accion={cfgEdit
               ? <span style={{ display: 'flex', gap: 5 }}>
                   <Boton onClick={guardarCfg} tono="primario" activo>Guardar</Boton>
                   <Boton onClick={() => { setCfgEdit(null); setMsgCfg('') }}>Cancelar</Boton>
                 </span>
               : <Boton onClick={() => setCfgEdit({ ...cfg })}>Editar</Boton>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
          {CAMPOS_CFG.map(c => (
            <div key={c.k} style={{ border: `1px solid ${LINE}`, borderRadius: 4, padding: '7px 10px' }}>
              <div style={{ fontSize: 10.5, color: SLATE, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>{c.l}</div>
              {cfgEdit
                ? <input type="number" step={c.u === 'veces' ? '0.1' : '1'} value={cfgEdit[c.k]}
                         onChange={e => setCfgEdit({ ...cfgEdit, [c.k]: e.target.value })}
                         style={{ ...inputEstilo, width: 90, marginTop: 3 }} />
                : <div style={{ fontSize: 18, fontWeight: 700, color: INK }}>{cfg[c.k]} <span style={{ fontSize: 11, color: SLATE, fontWeight: 400 }}>{c.u}</span></div>}
              <div style={{ fontSize: 10.8, color: SLATE, marginTop: 2, lineHeight: 1.35 }}>{c.d}</div>
            </div>
          ))}
        </div>
        {msgCfg && <div style={{ fontSize: 11.5, marginTop: 7, color: msgCfg.startsWith('Guardado') ? VERDE : ROJO }}>{msgCfg}</div>}
        <div style={{ fontSize: 11, color: SLATE, marginTop: 8, lineHeight: 1.5 }}>
          Son reglas de negocio, no técnicas: definen cuándo un producto pasa a lento, a inmovilizado (y abre una alerta) o a muerto.
          {cfg.actualizado_por ? ` Último cambio: ${cfg.actualizado_por}, ${String(cfg.actualizado_at || '').slice(0, 10)}.` : ''}
        </div>
      </Panel>

      <Panel titulo="Política de inventario por tipo"
             sub="plazo de entrega y días de cobertura objetivo; afecta el punto de reorden y la cantidad sugerida"
             accion={<span style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
               {recalc && <span style={{ fontSize: 11, color: SLATE }}>{recalc}</span>}
               <Boton onClick={recalcular} tono="primario" activo>Recalcular ahora</Boton>
             </span>}>
        <div style={{ overflowX: 'auto', maxHeight: 420, border: `1px solid ${LINE}`, borderRadius: 4 }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: PAPER }}>
                {['Tipo de producto', 'Plazo entrega', 'Cobertura objetivo', 'Nivel de servicio', 'Validada por Compras', ''].map((h, i) => (
                  <th key={h + i} style={{
                    padding: '7px 9px', textAlign: i === 0 || i === 5 ? 'left' : i === 4 ? 'center' : 'right',
                    fontSize: 10.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase',
                    letterSpacing: '.03em', borderBottom: `1px solid ${LINE}`,
                    position: 'sticky', top: 0, background: PAPER,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pol.map((p, i) => {
                const editando = edit?.tipo === p.tipo_producto
                return (
                  <tr key={p.tipo_producto} style={{ borderBottom: `1px solid ${LINE}`, background: i % 2 ? '#FCFCFD' : '#fff' }}>
                    <td style={{ padding: '5px 9px', color: INK }}>{p.tipo_producto}</td>
                    <td style={{ padding: '5px 9px', textAlign: 'right' }}>
                      {editando
                        ? <input value={edit.lead} onChange={e => setEdit({ ...edit, lead: e.target.value })}
                                 style={{ ...inputEstilo, width: 62, textAlign: 'right' }} />
                        : `${p.lead_time_dias} d`}
                    </td>
                    <td style={{ padding: '5px 9px', textAlign: 'right' }}>
                      {editando
                        ? <input value={edit.cob} onChange={e => setEdit({ ...edit, cob: e.target.value })}
                                 style={{ ...inputEstilo, width: 62, textAlign: 'right' }} />
                        : `${p.cobertura_obj} d`}
                    </td>
                    <td style={{ padding: '5px 9px', textAlign: 'right', color: SLATE }}>
                      {Math.round((p.nivel_servicio || 0.95) * 100)}%
                    </td>
                    <td style={{ padding: '5px 9px', textAlign: 'center' }}>
                      <label title={p.validado ? `Validada por ${p.validado_por || '—'} el ${String(p.validado_at || '').slice(0, 10)}` : 'Sin validar: los valores son supuestos'}
                             style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11,
                                      color: p.validado ? VERDE : AMBAR, fontWeight: 700 }}>
                        <input type="checkbox" checked={!!p.validado} onChange={() => alternarValidacion(p)} />
                        {p.validado ? 'sí' : 'pendiente'}
                      </label>
                    </td>
                    <td style={{ padding: '5px 9px' }}>
                      {editando
                        ? <span style={{ display: 'flex', gap: 5 }}>
                            <Boton onClick={guardar} activo tono="primario">{guardando ? '…' : 'Guardar'}</Boton>
                            <Boton onClick={() => setEdit(null)}>Cancelar</Boton>
                          </span>
                        : <Boton onClick={() => setEdit({ tipo: p.tipo_producto, lead: p.lead_time_dias, cob: p.cobertura_obj })}>
                            Editar
                          </Boton>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: SLATE, marginTop: 8, lineHeight: 1.5 }}>
          El <b>plazo de entrega</b> define cuánto debe guardar el CD (abastecer la red hasta la próxima llegada) y el stock de
          seguridad, que crece con la raíz del plazo: bajarlo de 60 a 30 días reduce cerca de un 30% el stock de seguridad de ese
          grupo sin bajar el nivel de servicio. Por eso estos valores deben venir de Compras con los plazos reales de cada
          proveedor: mientras estén "pendientes", el stock sobre el objetivo que muestra la app es referencial.
          Tras editar una política, usar "Recalcular ahora".
        </div>
      </Panel>
    </div>
  )
}
