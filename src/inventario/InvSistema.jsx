/* Sistema — salud de la fuente de datos y política de inventario por tipo. */

import { useState, useEffect } from 'react'
import {
  Kpi, Panel, Boton, inputEstilo, Cargando, ErrorBox, fN,
  INK, SLATE, LINE, PAPER, NAVY, ROJO, VERDE, AMBAR,
} from './invUI'
import { fetchSalud, fetchPoliticas, guardarPolitica } from './invData'

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

export function InvSistema() {
  const [salud, setSalud] = useState({})
  const [pol, setPol] = useState([])
  const [cargando, setCargando] = useState(true)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState(null)      // { tipo, lead, cob }
  const [guardando, setGuardando] = useState(false)

  const cargar = async () => {
    setCargando(true); setErr('')
    try {
      const [s, p] = await Promise.all([fetchSalud(), fetchPoliticas()])
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

      <Panel titulo="Política de inventario por tipo"
             sub="plazo de entrega y días de cobertura objetivo; afecta el punto de reorden y la cantidad sugerida">
        <div style={{ overflowX: 'auto', maxHeight: 420, border: `1px solid ${LINE}`, borderRadius: 4 }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: PAPER }}>
                {['Tipo de producto', 'Plazo entrega', 'Cobertura objetivo', 'Nivel de servicio', ''].map((h, i) => (
                  <th key={h + i} style={{
                    padding: '7px 9px', textAlign: i === 0 || i === 4 ? 'left' : 'right',
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
          Bajar el plazo de entrega es la palanca más barata que existe: reduce el stock de seguridad
          sin tocar el nivel de servicio. Pasar un tipo de 60 a 30 días libera cerca de un 30% del
          capital inmovilizado en ese grupo.
        </div>
      </Panel>
    </div>
  )
}
