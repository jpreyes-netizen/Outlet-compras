/* ════════════════════════════════════════════════════════════════════
   invInforme.js — Informe completo de inventario
   PDF: lectura ejecutiva (resúmenes + los 40 casos más relevantes de cada lista).
   Excel: lo mismo, pero con las listas completas, una hoja por sección.
   ════════════════════════════════════════════════════════════════════ */

import { informePdf, informeExcel } from './invReportes'
import { aplicarFiltros, nombreSuc, NOMBRE_NIVEL, ESTADOS_ALERTA } from './invData'
import { METODOLOGIA, METODOS, composicion, restarDias, fechaCorta } from './invProyeccion'

const TOPE_PDF = 40
const n = c => ({ ...c, num: true })

export function informeInventario({ formato, capital, base, scorecard, movimientos, prioridad, scope, cfg }) {
  const enAlcance = r => !scope || [r.sucursal_id, r.origen, r.destino].includes(scope)
  const b = (base || []).filter(enAlcance)
  const pdf = formato === 'pdf'
  const top = (filas, k) => [...filas].sort((x, y) => (+y[k] || 0) - (+x[k] || 0)).slice(0, pdf ? TOPE_PDF : undefined)

  const alertas = aplicarFiltros(b, { alertaVigente: true })
  const perdida = aplicarFiltros(b, { perdida: true })
  const movs = (movimientos || []).filter(enAlcance)

  // Metodología de la venta promedio, con las fechas exactas de las ventanas de este cálculo
  const fecha = b.find(r => r.fecha_calculo)?.fecha_calculo
  const ventanas = fecha
    ? `Calculado el ${fechaCorta(fecha)}. Ventana corta: del ${fechaCorta(restarDias(fecha, 28))} al ${fechaCorta(restarDias(fecha, 1))} (28 días completos). ` +
      `Ventana larga: del ${fechaCorta(restarDias(fecha, 84))} al ${fechaCorta(restarDias(fecha, 1))} (84 días completos).`
    : ''
  const salasConVenta = b.filter(r => r.vende && r.metodo && (+r.venta_84d > 0 || +r.demanda_dia > 0))
  const cuenta = m => salasConVenta.filter(r => r.metodo === m).length
  const composiciones = salasConVenta.map(r => ({ r, c: composicion(r) })).filter(x => x.c)
    .sort((x, y) => (+y.r.venta_84d || 0) - (+x.r.venta_84d || 0))
  const d2 = v => new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(+v || 0)

  const secciones = [
    {
      titulo: 'Cómo se calcula la venta promedio', hoja: 'Metodología', nota: ventanas,
      filas: [...METODOLOGIA.map((t, i) => ({ n: i + 1, regla: t })),
              ...Object.entries(METODOS).map(([k, m]) => ({ n: '', regla: `${m.l}: ${m.d} (${cuenta(k)} producto-sala con venta)` }))],
      cols: [{ k: 'n', l: '#' }, { k: 'regla', l: 'Regla' }],
    },
    {
      titulo: `Composición de la venta promedio por producto y sala${pdf && composiciones.length > TOPE_PDF ? ` (los ${TOPE_PDF} de mayor venta de ${composiciones.length})` : ''}`,
      hoja: 'Venta promedio',
      nota: 'Prom. diaria = unidades de la ventana ÷ días con stock (o ÷ 84 si casi no tuvo stock). Sin corregir = unidades ÷ días de calendario: la diferencia es demanda escondida por quiebres.',
      filas: (pdf ? composiciones.slice(0, TOPE_PDF) : composiciones),
      cols: [
        { k: 'sku', l: 'SKU', crudo: x => x.r.sku }, { k: 'producto', l: 'Producto', crudo: x => x.r.producto },
        { k: 'cat', l: 'Categoría', crudo: x => x.r.tipo_producto }, { k: 'sala', l: 'Sala', crudo: x => nombreSuc(x.r.sucursal_id) },
        { k: 'metodo', l: 'Método', crudo: x => METODOS[x.c.metodo].corto },
        { k: 'ventana', l: 'Ventana', crudo: x => `${fechaCorta(x.c.desde)} al ${fechaCorta(x.c.hasta)}` },
        n({ k: 'unid', l: 'Unidades', crudo: x => x.c.unidades }),
        { k: 'dias', l: 'Días con stock', crudo: x => x.c.metodo === 'calendario_84' ? 'calendario' : `${x.c.dias} de ${x.c.observados}` },
        { k: 'diaria', l: 'Prom. diaria', crudo: x => d2(x.c.diaria) }, { k: 'mensual', l: 'Prom. mensual', crudo: x => d2(x.c.mensual) },
        { k: 'cal', l: 'Sin corregir', crudo: x => d2(x.c.calendario) },
      ],
    },
    {
      titulo: 'Capital por bodega', hoja: 'Capital por bodega',
      nota: `Detenido: más de ${cfg.dias_lento} días sin moverse. Lento: ${cfg.dias_activo + 1} a ${cfg.dias_lento} días. ` +
            'Sobre el objetivo: unidades de productos que se mueven, por encima de lo que la bodega debería guardar.',
      filas: capital,
      cols: [
        { k: 'nombre', l: 'Bodega' }, n({ k: 'valor_total', l: 'Inventario' }),
        n({ k: 'detenido', l: 'Detenido', crudo: r => (+r.v_inmovilizado || 0) + (+r.v_muerto || 0) }),
        n({ k: 'v_lento', l: 'Lento' }), n({ k: 'v_exceso', l: 'Sobre objetivo' }), n({ k: 'v_transferible', l: 'Transferible' }),
        n({ k: 'cobertura_dias', l: 'Cobertura (días)' }), n({ k: 'alertas_abiertas', l: 'Alertas sin gestionar' }),
      ],
    },
    {
      titulo: 'Comparativo por ubicación', hoja: 'Comparativo',
      nota: 'Rotación y GMROI anualizados. En el CD la rotación mide cuántas veces la venta de la red consume su stock al año.',
      filas: (scorecard || []).filter(r => !scope || r.sucursal_id === scope || r.sucursal_id === 'red'),
      cols: [
        { k: 'nombre', l: 'Ubicación' }, n({ k: 'valor', l: 'Inventario' }),
        { k: 'rotacion', l: 'Rotación (x)' }, { k: 'gmroi', l: 'GMROI' }, { k: 'semanas_cobertura', l: 'Semanas de stock' },
        { k: 'instock_clave_hoy', l: 'SKU clave con stock (%)' }, n({ k: 'venta_perdida_84d', l: 'Venta perdida 84d' }),
        n({ k: 'perdida_con_stock_en_cd', l: 'Perdida con stock en CD' }),
      ],
    },
    {
      titulo: `Alertas vigentes${pdf && alertas.length > TOPE_PDF ? ` (las ${TOPE_PDF} de mayor capital de ${alertas.length})` : ''}`, hoja: 'Alertas',
      filas: top(alertas, 'valor_costo'),
      cols: [
        { k: 'sku', l: 'SKU' }, { k: 'producto', l: 'Producto' }, { k: 'sucursal_id', l: 'Bodega', crudo: r => nombreSuc(r.sucursal_id) },
        { k: 'nivel', l: 'Situación', crudo: r => NOMBRE_NIVEL[r.nivel] }, n({ k: 'dias_inmovil', l: 'Días sin moverse' }),
        n({ k: 'valor_costo', l: 'Capital' }), { k: 'accion', l: 'Qué hacer' },
        { k: 'alerta_estado', l: 'Alerta', crudo: r => ESTADOS_ALERTA[r.alerta_estado]?.l }, { k: 'alerta_nota', l: 'Gestión' },
      ],
    },
    {
      titulo: `Venta perdida por quiebre, 84 días${pdf && perdida.length > TOPE_PDF ? ` (los ${TOPE_PDF} mayores de ${perdida.length})` : ''}`, hoja: 'Venta perdida',
      filas: top(perdida, 'venta_perdida_84d'),
      cols: [
        { k: 'sku', l: 'SKU' }, { k: 'producto', l: 'Producto' }, { k: 'sucursal_id', l: 'Sala', crudo: r => nombreSuc(r.sucursal_id) },
        { k: 'estado', l: 'Reposición' }, n({ k: 'pct_quiebre', l: '% días sin stock' }), n({ k: 'venta_perdida_84d', l: 'Venta perdida' }),
        n({ k: 'stock_en_cd', l: 'Stock en CD' }), n({ k: 'sugerido', l: 'Reponer (unid.)' }),
      ],
    },
    {
      titulo: `Movimientos sugeridos${pdf && movs.length > TOPE_PDF ? ` (los ${TOPE_PDF} de mayor valor de ${movs.length})` : ''}`, hoja: 'Movimientos',
      filas: top(movs, 'valor_costo'),
      cols: [
        { k: 'tipo', l: 'Movimiento' }, { k: 'sku', l: 'SKU' }, { k: 'producto', l: 'Producto' },
        { k: 'origen', l: 'Desde', crudo: r => nombreSuc(r.origen) }, { k: 'destino', l: 'Hacia', crudo: r => nombreSuc(r.destino) },
        n({ k: 'unidades', l: 'Unidades' }), n({ k: 'valor_costo', l: 'Valor' }), n({ k: 'venta_recuperable', l: 'Venta recuperable' }), { k: 'ruta', l: 'Ruta' },
      ],
    },
    {
      titulo: `Compra sugerida por retorno del capital${pdf && prioridad.length > TOPE_PDF ? ` (primeras ${TOPE_PDF} de ${prioridad.length})` : ''}`, hoja: 'Compra sugerida',
      filas: pdf ? (prioridad || []).slice(0, TOPE_PDF) : prioridad || [],
      cols: [
        n({ k: 'prioridad', l: '#' }), { k: 'sku', l: 'SKU' }, { k: 'producto', l: 'Producto' }, { k: 'clase', l: 'Clase', crudo: r => (r.abc || 'D') + (r.xyz || 'Z') },
        n({ k: 'comprar_sugerido', l: 'Comprar' }), n({ k: 'inversion', l: 'Inversión' }), n({ k: 'margen_esperado', l: 'Margen esperado' }),
        { k: 'retorno_capital', l: 'ROI (x)' }, n({ k: 'capital_acumulado', l: 'Capital acumulado' }),
      ],
    },
  ]

  const titulo = `Análisis de stock${scope ? ' · ' + nombreSuc(scope) : ' · red completa'}`
  const sub = 'Fuente: BSALE sincronizado; indicadores recalculados cada madrugada'
  if (pdf) informePdf({ titulo, sub, secciones, archivo: 'informe_inventario' })
  else informeExcel({ secciones, archivo: 'informe_inventario' })
}
