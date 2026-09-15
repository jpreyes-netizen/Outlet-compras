/* Reponer — qué le falta a cada sala y qué se puede cubrir desde el CD. */

import { useState, useMemo } from 'react'
import {
  Kpi, Tag, Panel, Tabla, Boton, inputEstilo, fmt, fN, fD,
  SLATE, LINE, NAVY, ROJO, VERDE, AMBAR,
} from './invUI'
import { CL_ESTADO, CL_PATRON, ESTADOS, SALAS, nombreSuc } from './invData'

export function InvReponer({ kpiSku, asignacion, scopeUsuario, onProducto }) {
  const [modo, setModo] = useState('sala')          // sala | cd
  const [suc, setSuc] = useState(scopeUsuario || 'TODAS')
  const [estado, setEstado] = useState('TODOS')
  const [texto, setTexto] = useState('')

  const filas = useMemo(() => {
    let f = modo === 'sala' ? kpiSku : asignacion
    if (suc !== 'TODAS') f = f.filter(x => x.sucursal_id === suc)
    if (modo === 'sala' && estado !== 'TODOS') f = f.filter(x => x.estado === estado)
    if (texto.trim()) {
      const t = texto.trim().toLowerCase()
      f = f.filter(x => String(x.sku).toLowerCase().includes(t) ||
                        String(x.producto || '').toLowerCase().includes(t))
    }
    return f
  }, [modo, kpiSku, asignacion, suc, estado, texto])

  const tot = useMemo(() => {
    if (modo === 'cd') return {
      skus: filas.length,
      unidades: filas.reduce((a, f) => a + (+f.enviar_sugerido || 0), 0),
      valor: filas.reduce((a, f) => a + (+f.valor_envio || 0), 0),
      sinCd: filas.filter(f => f.criterio === 'CD sin stock').length,
    }
    return {
      skus: filas.length,
      unidades: filas.reduce((a, f) => a + (+f.sugerido || 0), 0),
      valor: filas.reduce((a, f) => a + (+f.sugerido || 0) * (+f.costo_unit || 0), 0),
      sinCd: filas.filter(f => f.estado === 'QUIEBRE').length,
    }
  }, [filas, modo])

  const colsSala = [
    { k: 'sku', l: 'SKU' },
    { k: 'producto', l: 'Producto', wrap: true },
    { k: 'sucursal_id', l: 'Sala', render: f => nombreSuc(f.sucursal_id), crudo: f => nombreSuc(f.sucursal_id) },
    { k: 'estado', l: 'Estado', render: f => <Tag texto={f.estado} color={CL_ESTADO[f.estado]} /> },
    { k: 'patron', l: 'Patrón', render: f => <Tag texto={(f.patron || '').slice(0, 4)} color={CL_PATRON[f.patron]} /> },
    { k: 'disponible', l: 'Disp.', num: true },
    { k: 'demanda_dia', l: 'Dem./día', num: true, render: f => fD(f.demanda_dia) },
    { k: 'safety_stock', l: 'Seguridad', num: true },
    { k: 'punto_reorden', l: 'Punto reorden', num: true },
    { k: 'dias_cobertura', l: 'Cobertura', num: true,
      render: f => f.dias_cobertura == null ? '—' : fN(f.dias_cobertura) + ' d' },
    { k: 'pct_quiebre', l: '% quiebre 84d', num: true,
      render: f => <span style={{ color: +f.pct_quiebre > 30 ? ROJO : undefined }}>{fN(f.pct_quiebre)}%</span> },
    { k: 'venta_perdida_84d', l: 'Venta perdida', num: true, render: f => fmt(f.venta_perdida_84d) },
    { k: 'sugerido', l: 'Reponer', num: true, render: f => <b>{fN(f.sugerido)}</b> },
  ]

  const colsCd = [
    { k: 'sku', l: 'SKU' },
    { k: 'producto', l: 'Producto', wrap: true },
    { k: 'sucursal_id', l: 'Destino', render: f => nombreSuc(f.sucursal_id), crudo: f => nombreSuc(f.sucursal_id) },
    { k: 'estado', l: 'Estado', render: f => <Tag texto={f.estado} color={CL_ESTADO[f.estado]} /> },
    { k: 'disponible', l: 'Tiene', num: true },
    { k: 'necesidad', l: 'Necesita', num: true },
    { k: 'stock_cd', l: 'Hay en CD', num: true },
    { k: 'enviar_sugerido', l: 'Enviar', num: true, render: f => <b style={{ color: NAVY }}>{fN(f.enviar_sugerido)}</b> },
    { k: 'criterio', l: 'Criterio', render: f =>
      <Tag texto={f.criterio} color={f.criterio === 'CD sin stock' ? ROJO : f.criterio === 'prorrateo' ? AMBAR : VERDE} /> },
    { k: 'valor_envio', l: 'Valor', num: true, render: f => fmt(f.valor_envio) },
  ]

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
        <Kpi label={modo === 'cd' ? 'SKU a transferir' : 'SKU a reponer'} valor={fN(tot.skus)} color={NAVY} />
        <Kpi label="Unidades" valor={fN(tot.unidades)} color={NAVY} />
        <Kpi label="Valor a costo" valor={fmt(tot.valor)} color={AMBAR} />
        <Kpi label={modo === 'cd' ? 'Sin stock en CD' : 'En quiebre'} valor={fN(tot.sinCd)}
             sub={modo === 'cd' ? 'hay que comprar, no transferir' : 'venta detenida hoy'}
             color={ROJO} alerta={tot.sinCd > 0} />
      </div>

      <Panel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
          <Boton onClick={() => setModo('sala')} activo={modo === 'sala'} tono="primario">Por sala</Boton>
          <Boton onClick={() => setModo('cd')} activo={modo === 'cd'} tono="primario">Desde el CD</Boton>
          <span style={{ width: 1, height: 20, background: LINE, margin: '0 3px' }} />
          <select value={suc} onChange={e => setSuc(e.target.value)} style={inputEstilo} disabled={!!scopeUsuario}>
            <option value="TODAS">Todas las salas</option>
            {SALAS.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          {modo === 'sala' && (
            <select value={estado} onChange={e => setEstado(e.target.value)} style={inputEstilo}>
              <option value="TODOS">Todos los estados</option>
              {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          )}
          <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar SKU o producto"
                 style={{ ...inputEstilo, minWidth: 180, flex: '1 1 180px' }} />
        </div>
      </Panel>

      <Tabla cols={modo === 'sala' ? colsSala : colsCd} filas={filas} onFila={f => onProducto(f.sku)}
             ordenInicial={modo === 'sala'
               ? { col: 'venta_perdida_84d', dir: 'desc' }
               : { col: 'valor_envio', dir: 'desc' }}
             nombreExport={modo === 'sala' ? 'reposicion_por_sala' : 'transferencias_desde_cd'} />

      <div style={{ fontSize: 11, color: SLATE, marginTop: 9, lineHeight: 1.5 }}>
        {modo === 'sala'
          ? 'La demanda se mide sobre los días con stock disponible, no sobre el calendario: un SKU que estuvo quebrado no debe aparecer como si no se vendiera.'
          : 'Reparto por déficit relativo de cobertura. Cuando el CD no alcanza para todas las salas se prorratea, en vez de dejar una completa y otra en cero.'}
      </div>
    </div>
  )
}
