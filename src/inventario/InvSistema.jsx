/* InvSistema.jsx — sub = reglas (umbrales y políticas por tipo) · datos (frescura de la fuente y tareas nocturnas) */

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Panel, KpiStrip, KpiCelda, Boton, Leyenda, Cargando, ErrorBox, inputEstilo, fN,
         INK, SLATE, BORDE, PAPER, NAVY, ROJO, VERDE, AMBAR } from './invUI'
import { fetchPoliticas, guardarPolitica, recalcularKpi, fetchConfig, guardarConfig, validarPolitica, CONFIG_DEFECTO } from './invData'

const CAMPOS = [
  { k: 'dias_activo', l: 'Activo hasta', u: 'días', d: 'Sin moverse hasta aquí, el producto está activo.' },
  { k: 'dias_lento', l: 'Lento hasta', u: 'días', d: 'Pasado esto es inmovilizado y abre una alerta.' },
  { k: 'dias_inmovilizado', l: 'Inmovilizado hasta', u: 'días', d: 'Pasado esto se considera muerto.' },
  { k: 'dias_reposicion_sala', l: 'Ciclo de reposición CD → sala', u: 'días', d: 'Lo mínimo que una posición debe poder guardar.' },
  { k: 'factor_sobredimension', l: 'Posición sobredimensionada', u: 'veces', d: 'Capacidad sobre N veces el máximo a guardar.' },
  { k: 'factor_desbalance', l: 'Capital mal asignado', u: 'veces', d: '% del inventario sobre N veces el % del margen.' },
  { k: 'meses_promedio', l: 'Meses para la venta promedio', u: 'meses', d: 'Meses cerrados que se promedian (sólo Inventario; abastecimiento usa su propia configuración).' },
  { k: 'min_dias_stock_mes', l: 'Días con stock para que un mes cuente', u: 'días', d: 'Con menos días con stock, el mes no cuenta: extrapolar desde pocos días amplifica el ruido.' },
]
const th = (al = 'left') => ({ padding: '7px 10px', textAlign: al, fontSize: 10, fontWeight: 700, color: SLATE, textTransform: 'uppercase',
                               letterSpacing: 0.4, borderBottom: `1px solid ${BORDE}`, position: 'sticky', top: 0, background: PAPER })

function Reglas({ usuario, onConfigCambiada }) {
  const [cfg, setCfg] = useState(CONFIG_DEFECTO), [pol, setPol] = useState(null), [err, setErr] = useState('')
  const [cfgEdit, setCfgEdit] = useState(null), [edit, setEdit] = useState(null), [filtro, setFiltro] = useState('')
  const cargar = async () => { try { const [c, p] = await Promise.all([fetchConfig(), fetchPoliticas()]); setCfg(c); setPol(p) } catch (e) { setErr(e.message) } }
  useEffect(() => { cargar() }, [])

  const guardarCfg = async () => {
    const v = Object.fromEntries(CAMPOS.map(c => [c.k, Number(cfgEdit[c.k])]))
    if (!(v.dias_activo < v.dias_lento && v.dias_lento < v.dias_inmovilizado)) return toast.error('Los días deben ir de menor a mayor: activo < lento < inmovilizado.')
    if (!(v.factor_sobredimension > 1 && v.factor_desbalance > 1)) return toast.error('Los factores deben ser mayores que 1.')
    if (!(v.dias_reposicion_sala > 0)) return toast.error('El ciclo de reposición debe ser mayor que 0.')
    if (!(v.meses_promedio >= 1 && v.meses_promedio <= 12)) return toast.error('Los meses para la venta promedio deben estar entre 1 y 12.')
    if (!(v.min_dias_stock_mes >= 1 && v.min_dias_stock_mes <= 28)) return toast.error('Los días con stock para que un mes cuente deben estar entre 1 y 28.')
    try { await guardarConfig(v, usuario); setCfgEdit(null); toast.success('Reglas guardadas. La venta promedio y las alertas usan estos valores desde el próximo recálculo (o con "Recalcular ahora").'); await cargar(); onConfigCambiada?.() }
    catch (e) { toast.error('No se pudo guardar: ' + e.message) }
  }
  const guardarPol = async () => {
    try { await guardarPolitica(edit.tipo, { lead_time_dias: Number(edit.lead) || 14, cobertura_obj: Number(edit.cob) || 60 }); setEdit(null); toast.success('Política guardada. Usa "Recalcular ahora" para verla reflejada.'); await cargar() }
    catch (e) { toast.error(e.message) }
  }
  const validar = async p => { try { await validarPolitica(p.tipo_producto, !p.validado, usuario); await cargar() } catch (e) { toast.error(e.message) } }
  const recalcular = async () => {
    const id = toast.loading('Recalculando indicadores…')
    try { await recalcularKpi(); toast.success('Indicadores recalculados.', { id }); onConfigCambiada?.() } catch (e) { toast.error(e.message, { id }) }
  }

  if (err) return <ErrorBox>{err}</ErrorBox>
  if (!pol) return <Cargando />
  const visibles = pol.filter(p => !filtro || p.tipo_producto.toLowerCase().includes(filtro.toLowerCase()))
  const pendientes = pol.filter(p => !p.validado).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Panel titulo="Reglas de antigüedad y espacio" sub="umbrales con que se clasifican los productos y las posiciones de bodega"
        acciones={cfgEdit
          ? <span style={{ display: 'inline-flex', gap: 6 }}><Boton onClick={guardarCfg} tono="primario" activo>Guardar</Boton><Boton onClick={() => setCfgEdit(null)}>Cancelar</Boton></span>
          : <Boton onClick={() => setCfgEdit({ ...cfg })} tono="primario">Editar</Boton>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          {CAMPOS.map(c => (
            <div key={c.k} style={{ border: `1px solid ${BORDE}`, borderRadius: 8, padding: '8px 11px' }}>
              <div style={{ fontSize: 9.5, color: SLATE, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{c.l}</div>
              {cfgEdit
                ? <input type="number" step={c.u === 'veces' ? '0.1' : '1'} value={cfgEdit[c.k]} onChange={e => setCfgEdit({ ...cfgEdit, [c.k]: e.target.value })}
                         style={{ ...inputEstilo, width: 100, marginTop: 4 }} />
                : <div style={{ fontSize: 18, fontWeight: 700, color: INK }}>{cfg[c.k]} <span style={{ fontSize: 11, color: SLATE, fontWeight: 400 }}>{c.u}</span></div>}
              <div style={{ fontSize: 10.8, color: SLATE, marginTop: 2, lineHeight: 1.35 }}>{c.d}</div>
            </div>
          ))}
        </div>
        <Leyenda nota={<>Son reglas de negocio: definen cuándo un producto pasa a lento, a inmovilizado (y abre una alerta) o a muerto, y cuándo una
          posición de bodega se considera mal dimensionada.{cfg.actualizado_por ? ` Último cambio: ${cfg.actualizado_por}, ${String(cfg.actualizado_at || '').slice(0, 10)}.` : ''}</>} />
      </Panel>

      <Panel titulo="Política de inventario por tipo de producto"
        sub={pendientes ? `${pendientes} de ${pol.length} sin validar por Compras: mientras tanto, el stock "sobre el objetivo" es referencial` : 'todas validadas por Compras'}
        acciones={<span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar tipo" style={{ ...inputEstilo, width: 160 }} />
          <Boton onClick={recalcular} tono="primario" activo>Recalcular ahora</Boton>
        </span>} sinPadding>
        <div style={{ overflow: 'auto', maxHeight: 460 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr>{['Tipo de producto', 'Plazo de entrega', 'Cobertura objetivo', 'Nivel de servicio', 'Validada por Compras', ''].map((h, i) =>
              <th key={h + i} style={th(i === 0 || i === 5 ? 'left' : i === 4 ? 'center' : 'right')}>{h}</th>)}</tr></thead>
            <tbody>{visibles.map(p => {
              const ed = edit?.tipo === p.tipo_producto
              return (
                <tr key={p.tipo_producto} style={{ borderBottom: `1px solid ${BORDE}`, background: p.validado ? '#fff' : AMBAR + '08' }}>
                  <td style={{ padding: '6px 10px', color: INK }}>{p.tipo_producto}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>{ed ? <input value={edit.lead} onChange={e => setEdit({ ...edit, lead: e.target.value })} style={{ ...inputEstilo, width: 70, textAlign: 'right' }} /> : `${p.lead_time_dias} días`}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>{ed ? <input value={edit.cob} onChange={e => setEdit({ ...edit, cob: e.target.value })} style={{ ...inputEstilo, width: 70, textAlign: 'right' }} /> : `${p.cobertura_obj} días`}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: SLATE }}>{Math.round((p.nivel_servicio || 0.95) * 100)}%</td>
                  <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                    <label title={p.validado ? `Validada por ${p.validado_por || '—'} el ${String(p.validado_at || '').slice(0, 10)}` : 'Sin validar: los valores son supuestos'}
                           style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11.5, color: p.validado ? VERDE : AMBAR, fontWeight: 700 }}>
                      <input type="checkbox" checked={!!p.validado} onChange={() => validar(p)} /> {p.validado ? 'sí' : 'pendiente'}
                    </label>
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    {ed ? <span style={{ display: 'inline-flex', gap: 5 }}><Boton onClick={guardarPol} tono="primario" activo>Guardar</Boton><Boton onClick={() => setEdit(null)}>Cancelar</Boton></span>
                        : <Boton onClick={() => setEdit({ tipo: p.tipo_producto, lead: p.lead_time_dias, cob: p.cobertura_obj })}>Editar</Boton>}
                  </td>
                </tr>)
            })}</tbody>
          </table>
        </div>
        <div style={{ padding: '0 12px 12px' }}>
          <Leyenda nota={<>El <b>plazo de entrega</b> define cuánto debe guardar el CD (abastecer la red hasta la próxima llegada) y el stock de
            seguridad, que crece con la raíz del plazo: bajarlo de 60 a 30 días reduce cerca de un 30% el stock de seguridad de ese grupo.
            Por eso deben venir de Compras con los plazos reales de cada proveedor. Tras editar, usar "Recalcular ahora".</>} />
        </div>
      </Panel>
    </div>
  )
}

function Datos({ salud }) {
  const hoy = new Date().toISOString().slice(0, 10)
  const ventaFresca = salud.ventas_dia_ultima_fecha >= new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
  const stockFresco = salud.stock_ultimo_snapshot === hoy
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <KpiStrip>
        <KpiCelda l="Última venta cargada" v={salud.ventas_dia_ultima_fecha || '—'} sub={ventaFresca ? 'al día' : 'atrasada'} color={ventaFresca ? VERDE : ROJO} destacar={!ventaFresca} />
        <KpiCelda l="Último inventario" v={salud.stock_ultimo_snapshot || '—'} sub={stockFresco ? 'de hoy' : 'atrasado'} color={stockFresco ? VERDE : AMBAR} />
        <KpiCelda l="Indicadores calculados" v={salud.kpi_actualizado || '—'} sub={`historia desde ${salud.historia_desde || '—'}`} color={NAVY} />
        <KpiCelda l="Productos en el maestro" v={fN(salud.skus_maestro)} color={NAVY} />
        <KpiCelda l="Stock sin costo" v={fN(salud.skus_stock_sin_costo)} sub="no se puede valorizar" color={+salud.skus_stock_sin_costo > 0 ? ROJO : VERDE} />
        <KpiCelda l="Sincronizaciones colgadas" v={fN(salud.syncs_colgados)} color={+salud.syncs_colgados > 0 ? ROJO : VERDE} />
      </KpiStrip>
      <Panel titulo="Sincronización automática" sub="tareas nocturnas, sin intervención manual (hora de Chile)" sinPadding>
        <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
          <tbody>{[
            ['01:30', 'Inventario de todas las ubicaciones desde BSALE'],
            ['02:00', 'Ventas de los últimos 5 días'],
            ['02:40', 'Recálculo de indicadores, alertas y foto diaria del capital'],
            ['Día 2 del mes', 'Barrido profundo del mes anterior (recaptura anulaciones y notas de crédito)'],
            ['Domingos 01:40', 'Maestro de productos desde BSALE'],
          ].map(([h, q]) => (
            <tr key={h} style={{ borderBottom: `1px solid ${BORDE}` }}>
              <td style={{ padding: '7px 12px', fontWeight: 700, color: INK, whiteSpace: 'nowrap', width: 140 }}>{h}</td>
              <td style={{ padding: '7px 12px', color: SLATE }}>{q}</td>
            </tr>))}</tbody>
        </table>
      </Panel>
    </div>
  )
}

export function InvSistema({ sub, salud, usuario, onConfigCambiada }) {
  return sub === 'datos' ? <Datos salud={salud} /> : <Reglas usuario={usuario} onConfigCambiada={onConfigCambiada} />
}
