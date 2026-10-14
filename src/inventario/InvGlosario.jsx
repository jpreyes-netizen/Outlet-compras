/* InvGlosario.jsx — todas las definiciones en un lugar. Se arma desde los mismos diccionarios que usa la app. */

import { Panel, Leyenda } from './invUI'
import { nivelesDesde, usosDesde, TRAMOS_COB, ACCIONES, CL_ESTADO, AYUDA_ESTADO, CL_PATRON, AYUDA_PATRON, ESTADOS_ALERTA, CL_ABC } from './invData'

export function InvGlosario({ cfg }) {
  const g = (titulo, items, nota) => <Panel titulo={titulo}><Leyenda titulo="Definiciones" items={items} nota={nota} /></Panel>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {g('Situación del producto (antigüedad)', nivelesDesde(cfg).map(n => ({ c: n.c, t: n.l, d: n.d })),
        'Días sin moverse: desde la última venta (en el CD, el último despacho) o la última llegada, lo más reciente. Los umbrales se editan en Configuración.')}
      {g('Estado de reposición (salas)', Object.keys(CL_ESTADO).map(k => ({ c: CL_ESTADO[k], t: k.charAt(0) + k.slice(1).toLowerCase(), d: AYUDA_ESTADO[k] })),
        'La demanda se mide sobre los días con stock disponible: un producto que estuvo quebrado no aparece como si no se vendiera.')}
      {g('Indicadores', [
        { t: 'Capital a costo', d: 'unidades × costo unitario vigente.' },
        { t: 'Venta perdida', d: 'venta diaria en los días con stock × días sin stock, en los últimos 84 días, a precio realmente cobrado.' },
        { t: 'Cobertura', d: 'días de venta que cubre el stock. En el CD, contra la venta de toda la red.' },
        { t: 'Sobre el objetivo', d: 'unidades de productos que se mueven, por encima de lo que la bodega debería guardar (sala: cobertura objetivo + seguridad; CD: hasta la próxima llegada + un ciclo).' },
        { t: 'Rotación', d: 'costo de lo vendido en un año ÷ inventario a costo. Home Depot: 4,5 veces.' },
        { t: 'GMROI', d: 'margen anual por cada peso invertido en inventario. Bajo 1 no devuelve lo que inmoviliza.' },
        { t: 'Productos clave', d: 'los que suman el 80% de la venta de cada sala; la referencia es tener stock en más del 95%.' },
        { t: 'Venta comparable', d: 'contra el mismo período del año anterior; excluye salas con menos de 12 meses abiertas.' },
      ])}
      {g('Qué hacer (acciones sugeridas)', Object.entries(ACCIONES).map(([t, d]) => ({ t, d })))}
      {g('Alertas', Object.values(ESTADOS_ALERTA).map(e => ({ c: e.c, t: e.l })),
        `Una alerta se abre una sola vez por producto y bodega al cruzar los ${cfg.dias_lento} días sin moverse, y se cierra sola cuando el producto vuelve a moverse o se queda sin stock.`)}
      {g('Cobertura por tramos', TRAMOS_COB.map(t => ({ c: t.c, t: t.l, d: t.d })))}
      {g('Uso de las posiciones de bodega', usosDesde(cfg).map(u => ({ c: u.c, t: u.k, d: u.d })))}
      {g('Patrón de demanda y clases', [
        ...Object.keys(CL_PATRON).map(k => ({ c: CL_PATRON[k], t: k.charAt(0) + k.slice(1).toLowerCase().replace('_', ' '), d: AYUDA_PATRON[k] })),
        ...['A', 'B', 'C', 'D'].map(k => ({ c: CL_ABC[k], t: 'Clase ' + k, d: { A: 'primer 80% del margen', B: 'del 80% al 95%', C: 'último 5%', D: 'sin margen' }[k] })),
      ])}
    </div>
  )
}
