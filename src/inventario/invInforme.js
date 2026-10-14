/* ════════════════════════════════════════════════════════════════════
   invInforme.js — Informe completo de inventario
   PDF: lectura ejecutiva (resúmenes + los 40 casos más relevantes de cada lista).
   Excel: lo mismo, pero con las listas completas, una hoja por sección.
   ════════════════════════════════════════════════════════════════════ */

import { informePdf, informeExcel } from './invReportes'
import { aplicarFiltros, nombreSuc, NOMBRE_NIVEL, ESTADOS_ALERTA } from './invData'

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

  const secciones = [
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
