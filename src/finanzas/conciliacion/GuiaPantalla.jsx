import { useState } from 'react'

/* ═══════════════════════════════════════════════════════════════════════
   GUÍA INTEGRADA (27-oct-2026) — Clasificar, imputar y conciliar
   Un solo componente con el contenido de cada pantalla: cómo se trabaja,
   el siguiente paso recomendado (lo calcula la pantalla con sus datos),
   la leyenda de estados y marcas, y un glosario para quien llega sin conocer
   el sistema. También centraliza las leyendas que aparecen al posar el mouse
   sobre columnas (DataGrid prop `ayudas`) y chips (ayudaChip).
   ═══════════════════════════════════════════════════════════════════════ */

const NAVY = '#16213E', INK = '#1C1C1E', SLATE = '#6E6E73', BORDE = '#E5E7EB', VERDE = '#1E7A44', AMBAR = '#B25E09', ROJO = '#B42318', AZUL = '#1D4ED8', MORADO = '#6D28D9'

const E = (nombre, color, texto) => ({ nombre, color, texto })
const G = (termino, texto) => ({ termino, texto })

export const GLOSARIO_BASE = [
  G('Plan único', 'El mismo plan con que se clasifica el banco: cuenta madre › subcuenta › centro de costo. Las facturas y los pagos usan las mismas subcuentas y los mismos centros, así todo se compara igual.'),
  G('Cuenta madre', 'Agrupación del plan único (ej. 710 Gastos operacionales). Define si la subcuenta exige centro de costo.'),
  G('Subcuenta', 'La cuenta de gestión que eliges (ej. 710.03 Herramientas para la operación). Cada subcuenta lleva a una cuenta contable formal de 7 dígitos, que se muestra en gris.'),
  G('Centro de costo', 'Dónde se gasta: área y sede (ej. 10201 OPS - CD Maipú). Áreas: ADM administración, COM comercial, OPS operaciones y bodega, NEG negocios.'),
  G('Cuenta contable', 'La cuenta formal del libro mayor (ej. 5212708). No se elige a mano: sale de la subcuenta.'),
  G('Imputar', 'Asignar a una factura su subcuenta y su centro de costo.'),
  G('Clasificar', 'Asignar a un movimiento del banco su subcuenta, su centro y qué lo respalda (factura, boleta, traspaso…).'),
  G('Conciliar / calzar', 'Unir cada pago del banco con la factura que paga, para que la factura quede saldada y el pago quede explicado.'),
  G('Nota de crédito (NC)', 'Documento que resta a una factura. Se aplica a su factura de origen; en los totales resta.'),
  G('Período cerrado', 'Mes ya declarado. Lo que se cambie ahí queda registrado y puede exigir un ajuste contable aparte.'),
]

const GUIAS = {
  imputar_proveedores: {
    titulo: 'Imputar facturas · Proveedores',
    intro: 'Aquí defines, una vez por proveedor, a qué subcuenta y a qué centro de costo van sus facturas. La regla se aplica a todas sus facturas y a las que lleguen después.',
    pasos: [
      'Recorre los chips de izquierda a derecha: "Por imputar" reúne todo lo pendiente.',
      'Sin regla o Falta subcuenta: haz clic en la celda Cuenta (plan único) y elige la subcuenta. Puedes escribir el código (710) o el nombre (herramientas), sin tildes.',
      'Falta centro: haz clic en Centro de costo y elige área y sede (ej. OPS - CD Maipú). Si el proveedor atiende varias sedes, elige "Por factura" y el centro se decide en cada factura.',
      'Por confirmar: todo viene sugerido. Revísalo y confirma con ✓, o marca varios y usa "✓ Confirmar subcuenta y centro".',
      'Clic en el nombre del proveedor: se abre su ficha con su regla, cómo lo clasificas en el banco y todas sus facturas, con el PDF de cada una para ver qué se compró.',
      'El número de "Por imputar" te lleva directo a las facturas pendientes de ese proveedor.',
    ],
    leyenda: [
      E('Sin regla', ROJO, 'El proveedor no tiene cuenta: elige su subcuenta.'),
      E('Falta subcuenta', ROJO, 'Su cuenta contable la comparten varias subcuentas y hay que elegir cuál.'),
      E('Falta centro', ROJO, 'La subcuenta exige centro de costo y no lo tiene.'),
      E('Por confirmar', AMBAR, 'Subcuenta y centro vienen sugeridos; nadie los ha confirmado.'),
      E('Imputado', VERDE, 'Subcuenta y centro confirmados. Sus facturas nuevas llegan imputadas.'),
      E('sug.', AMBAR, 'Centro sugerido por cómo clasificas en el banco. Confírmalo o cámbialo.'),
      E('Por factura', AZUL, 'Este proveedor no tiene un centro único: cada factura elige el suyo.'),
    ],
    glosario: [G('Regla del proveedor', 'La subcuenta, el centro y el plazo de pago que definiste para el proveedor. Manda sobre sus facturas, salvo las que tengan una excepción propia.'), G('Plazo', 'Días de crédito del proveedor. Define el vencimiento de sus facturas. El asterisco indica el plazo por defecto (30 días).')],
  },
  imputar_facturas: {
    titulo: 'Imputar facturas · Facturas',
    intro: 'Aquí se resuelven las excepciones: facturas que no siguen la regla de su proveedor o que no tienen regla. Lo que cambies aquí afecta solo a esa factura.',
    pasos: [
      '"Por imputar" muestra lo pendiente. Primero mira las que tienen ✦ Sugerencia: el porcentaje dice qué tan segura es y, al posar el mouse, por qué.',
      'Acepta una sugerencia con ✓, o marca varias y usa "✦ Aceptar sugerencias". Si no hay sugerencia, pide una a la IA (botón ✦ IA) o elige a mano en la celda.',
      'Marca varias facturas y usa la barra para asignar subcuenta o centro a todas de una vez.',
      '¿No sabes qué se compró? Clic en el folio para abrir el PDF, o en el nombre del proveedor para ver su ficha completa.',
      'Por confirmar: la subcuenta o el centro vienen sugeridos. Si están bien, confirma con ✓.',
      'Cuando una factura queda Imputada desaparece de "Por imputar". Al final, revisa el Resumen.',
    ],
    leyenda: [
      E('Sin cuenta', ROJO, 'Cayó en la cuenta Pendientes: elige su subcuenta.'),
      E('Falta subcuenta', ROJO, 'No tiene subcuenta. Acepta la sugerencia o elígela.'),
      E('Falta centro', ROJO, 'La subcuenta exige centro de costo y no lo tiene.'),
      E('Por confirmar', AMBAR, 'Subcuenta o centro sugeridos: confirma con ✓.'),
      E('Imputada', VERDE, 'Subcuenta y centro confirmados.'),
      E('95% / 85%', VERDE, 'Sugerencia con evidencia directa: el pago de esa factura en el banco o el historial del proveedor.'),
      E('75%', AMBAR, 'Evidencia indirecta: movimientos del banco con el nombre del proveedor.'),
      E('55%', SLATE, 'Solo una inferencia: la subcuenta más usada para esa cuenta contable. Revísala.'),
      E('IA', MORADO, 'Propuesta de la inteligencia artificial, con su razón al posar el mouse.'),
      E('OC', AZUL, 'Centro tomado del destino de la orden de compra.'),
      E('≠ banco', ROJO, 'El pago de esta factura está en otro centro en el banco.'),
    ],
    glosario: [G('Excepción por factura', 'Una subcuenta o un centro distinto al de la regla del proveedor, válido solo para esa factura.'), G('Sugerencia', 'Propuesta automática basada en tu propia clasificación del banco y en el historial del proveedor. No se aplica sola: tú la aceptas.')],
  },
  imputar_resumen: {
    titulo: 'Imputar facturas · Resumen',
    intro: 'Tabla dinámica de lo imputado. Sirve para ver dónde está el gasto por mes, por cuenta y por centro de costo, y cuánto falta por imputar.',
    pasos: [
      'Elige qué va en las filas (cuenta, centro, sede, proveedor) y en las columnas (mes, centro, sede).',
      'Cambia el valor: neto sin IVA, total con IVA o número de facturas. Las notas de crédito restan y se muestran en rojo.',
      'Haz clic en una celda para ver las facturas que la componen; en una fila de cuenta madre, para abrir sus subcuentas.',
      'Los indicadores de arriba dicen qué porcentaje tiene subcuenta y centro: si no es 100%, falta imputación.',
      'Exporta a Excel cuando necesites compartirlo.',
    ],
    leyenda: [E('Sin subcuenta asignada', AMBAR, 'Facturas aún sin subcuenta: aparecen agrupadas por su cuenta contable.'), E('Rojo', ROJO, 'Monto negativo: notas de crédito.')],
    glosario: [],
  },
  calzar: {
    titulo: 'Calzar facturas con pagos',
    intro: 'El motor busca, con reglas estrictas, qué pago del banco paga qué factura. Solo propone calces seguros; lo dudoso queda para que lo decidas tú.',
    pasos: [
      'Define el período de las facturas y pulsa "Buscar calces". Por defecto revisa de septiembre a enero y deja octubre fuera.',
      'Revisa los calces mes a mes, del más reciente al más antiguo. Cada fila dice la regla usada y, al posar el mouse, el detalle.',
      'Desmarca los que no te convenzan y aplica el resto con "Aplicar N de mes" o "Aplicar marcados".',
      'Lo que el motor no calza se concilia a mano: busca la factura por folio, RUT, proveedor o monto y ábrela con su proveedor (facturas y pagos lado a lado).',
    ],
    leyenda: [
      E('Folio citado', VERDE, 'La transferencia menciona el folio de la factura; mismo RUT y monto exacto.'),
      E('Tope $7M', VERDE, 'Varias transferencias del mismo día al mismo proveedor, cortadas por el tope del banco, suman exacto la factura.'),
      E('Monto exacto', VERDE, 'Único pago y única factura del proveedor con ese monto.'),
      E('Exacto por recencia', AMBAR, 'Hay montos repetidos: se parea la factura más reciente con el pago más reciente.'),
      E('Un pago, varias facturas', AZUL, 'Un pago cubre exacto varias facturas seguidas.'),
      E('Una factura, varios pagos', AZUL, 'La factura se pagó en varios pagos seguidos.'),
      E('Bolsa exacta', AZUL, 'Un tramo de facturas y un tramo de pagos suman lo mismo al peso.'),
    ],
    glosario: [G('Saldo', 'Lo que falta por pagar de una factura, ya descontadas las notas de crédito y los pagos vinculados.'), G('Transferencia masiva (TEF)', 'Un solo cargo del banco que agrupa varias transferencias; el informe del banco dice a quién fue cada una.'), G('Tope $7M', 'El banco limita cada transferencia a $7 millones: un pago mayor se corta en varias transferencias el mismo día.')],
  },
  banco: {
    titulo: 'Clasificar y conciliar (banco)',
    intro: 'Cada línea de la cartola necesita tres cosas: la subcuenta (qué es), el centro de costo (dónde) y el respaldo (qué documento la explica). Si es un pago de factura, además se vincula con ella.',
    pasos: [
      'Elige la cuenta (Santander o Global66) y el mes. "Por trabajar" reúne todo lo pendiente.',
      'Abre una línea: el cursor queda en el buscador de subcuenta. Escribe el código (710.03) o el nombre; Enter elige. Si la subcuenta exige centro, salta solo al campo siguiente.',
      '"Guardar y siguiente" (o Ctrl+Enter) guarda y pasa a la línea que sigue, en el mismo orden de la grilla.',
      'Si la línea es un pago de factura, vincúlala en "Vincular con factura": las candidatas salen por monto parecido y por folio citado.',
      '"Aplicar automáticas" clasifica solo las sugerencias que aciertan 97% o más en el historial. "A revisar" muestra líneas donde la segunda opinión discrepa.',
      'Enter en la barra de búsqueda busca en todo el año; Esc vuelve al mes.',
    ],
    leyenda: [
      E('Sin clasificar', ROJO, 'No tiene subcuenta.'),
      E('Sin centro de costo', ROJO, 'La subcuenta exige centro y no lo tiene.'),
      E('Por conciliar', AMBAR, 'Es un pago de factura y aún no tiene la factura vinculada.'),
      E('Con sugerencia', AZUL, 'El motor propone subcuenta y centro; al posar el mouse ves por qué.'),
      E('A revisar', AMBAR, 'La segunda opinión del historial discrepa de la clasificación actual.'),
      E('Conciliado', VERDE, 'Clasificado y con su respaldo completo.'),
    ],
    glosario: [G('Cartola', 'El extracto del banco, importado línea a línea.'), G('Respaldo', 'El documento que explica el movimiento: factura de compra, boleta, nota de crédito, traspaso entre cuentas, remuneración, etc.'), G('Segunda opinión', 'Lo que el historial del mismo RUT o de la misma glosa habría puesto. Si discrepa de lo actual, la línea queda "A revisar".')],
  },
  ev_banco: {
    titulo: 'Estado y vínculos · Libro banco por mes',
    intro: 'Cuánto hay en cada cuenta madre y subcuenta, mes a mes y por origen. Haz clic en una celda para ver sus movimientos y reclasificar.',
    pasos: ['Elige la cuenta y el año.', 'Haz clic en una celda para abrir los movimientos que la componen.', 'Desde ahí puedes cambiar subcuenta o centro de varios a la vez.'],
    leyenda: [], glosario: [],
  },
  ev_compras: {
    titulo: 'Estado y vínculos · Compras por proveedor',
    intro: 'El libro espejo: a la izquierda las facturas del proveedor, a la derecha sus pagos. Sirve para conciliar a mano lo que el motor no calza.',
    pasos: ['Elige un proveedor.', 'Marca facturas y pagos que se corresponden y usa "Vincular selección". El reparto va de lo más reciente a lo más antiguo.', 'Si el pago no está entre los suyos, búscalo por monto o glosa: puede venir de otro RUT (un alias).'],
    leyenda: [E('Calce exacto', VERDE, 'Factura y pago con el mismo monto: vinculación en un clic.')], glosario: [],
  },
  ev_revision: {
    titulo: 'Estado y vínculos · Revisar imputación',
    intro: 'Hallazgos que conviene corregir: líneas sin subcuenta, respaldo incorrecto, RUT distinto, masivos sin vincular, signo contrario.',
    pasos: ['Recorre los hallazgos por tipo.', 'Cada uno trae una corrección de un clic; si no aplica, ábrelo y decide a mano.'],
    leyenda: [], glosario: [],
  },
}

// Leyendas por columna (prop `ayudas` del DataGrid) y por chip
export const AYUDAS_COL = {
  imputar_proveedores: {
    razon_social: 'Proveedor y RUT. Clic para abrir su ficha: regla, cómo lo clasificas en el banco y sus facturas con PDF.',
    n_facturas: 'Facturas de 2026 del proveedor (sin contar notas de crédito).',
    monto_ytd: 'Total facturado en 2026, con IVA.',
    ultima_fecha: 'Fecha de su última factura.',
    cuenta: 'Subcuenta del plan único (la misma del banco). En gris, la cuenta contable formal a la que lleva. Clic para cambiarla: se aplica a todas sus facturas.',
    ceco_id: 'Centro de costo del proveedor: área y sede. "Por factura" significa que cada factura elige el suyo. Clic para cambiarlo.',
    plazo: 'Días de crédito del proveedor. Define el vencimiento de sus facturas; el asterisco es el plazo por defecto (30 días). Clic para cambiarlo.',
    estado_regla: 'Estado de la imputación según el plan único. ✓ confirma la subcuenta y el centro que muestra.',
    n_sugeridas: 'Facturas de este proveedor que aún no están imputadas. Clic para trabajarlas.',
    saldo_abierto: 'Facturas por pagar, ya descontadas las notas de crédito.',
    nc_por_aplicar: 'Notas de crédito sin imputar a su factura de origen.',
    saldo_vencido: 'Monto vencido según el plazo del proveedor.',
    n_vencidas: 'Facturas vencidas según el plazo del proveedor.',
  },
  imputar_facturas: {
    fecha_emision: 'Fecha de emisión del documento.',
    doc: 'Tipo y folio del documento. Clic para abrir el PDF.',
    razon_social: 'Proveedor y RUT. Clic para ver su ficha con todas sus facturas.',
    monto_libro: 'Total con IVA. Las notas de crédito aparecen en negativo.',
    cuenta: 'Subcuenta del plan único de esta factura; en gris, la cuenta contable. Clic para cambiarla solo en esta factura.',
    ceco_nombre: 'Centro de costo de esta factura (área y sede). "sug." = sugerido; "≠ banco" = el pago está en otro centro. Clic para cambiarlo.',
    sugerencia: 'Propuesta automática de subcuenta y centro, con su confianza. Pasa el mouse para ver por qué; ✓ la acepta.',
    origen_clasificacion: 'Estado de la imputación según el plan único. ✓ confirma lo que la factura ya muestra.',
    estado_pago: 'Si la factura está pagada, parcialmente pagada o por pagar, según los pagos vinculados.',
    saldo: 'Lo que falta por pagar, descontadas las notas de crédito y los pagos vinculados.',
    vencimiento: 'Días hasta (o desde) el vencimiento, según el plazo del proveedor.',
    asiento_numero: 'Número del asiento contable que generó la factura.',
  },
  banco: {
    fecha: 'Fecha del movimiento en la cartola.',
    sit: 'Estado del movimiento: qué le falta para quedar conciliado.',
    descripcion: 'Glosa de la cartola. Si trae RUT o folio, el motor los usa para sugerir.',
    monto: 'Monto del movimiento: cargos en negativo, abonos en positivo.',
    aplicado: 'Parte del monto ya vinculada a facturas u otros respaldos.',
    pendiente: 'Parte del monto que aún no tiene respaldo vinculado.',
    subcuenta: 'Subcuenta del plan único (qué es el movimiento). Clic para clasificar.',
    revision: 'Segunda opinión: lo que el historial del mismo RUT o glosa habría puesto. Si discrepa, revísalo.',
    ceco: 'Centro de costo (área y sede). Obligatorio en cuentas de gasto e ingreso.',
    tipo_respaldo: 'Qué documento explica el movimiento: factura de compra, boleta, traspaso, remuneración, etc.',
    mes_nominal: 'Mes al que pertenece el movimiento para efectos de gestión, si difiere de la fecha de la cartola.',
    origen: 'Quién o qué lo clasificó: a mano, en lote, Excel, regla, historial, IA o vínculo con factura.',
  },
  estado_vinculos: {
    fecha: 'Fecha del documento o movimiento.', folio: 'Folio del documento.', proveedor: 'Proveedor y RUT.', razon_social: 'Proveedor y RUT.',
    monto: 'Monto del documento o movimiento.', saldo: 'Lo que falta por pagar o por explicar.', pagado: 'Monto ya vinculado a pagos.',
    subcuenta: 'Subcuenta del plan único.', ceco: 'Centro de costo (área y sede).', estado: 'Estado del vínculo.',
    hallazgo: 'Qué conviene corregir en esta línea.', accion: 'Corrección sugerida, de un clic.', descripcion: 'Glosa de la cartola.',
  },
}

const AYUDAS_CHIP = {
  imputar_proveedores: {
    trabajo: 'Todos los proveedores que aún no están imputados.', sin_regla: 'Proveedores sin cuenta: elige su subcuenta.',
    falta_subcuenta: 'Su cuenta contable la comparten varias subcuentas: elige cuál.', falta_centro: 'La subcuenta exige centro de costo y no lo tienen.',
    por_confirmar: 'Subcuenta y centro vienen sugeridos: revisa y confirma con ✓.', imputado: 'Subcuenta y centro confirmados.', todos: 'Todos los proveedores con facturas.',
  },
  imputar_facturas: {
    trabajo: 'Todas las facturas que aún no están imputadas.', sugerencia: 'Facturas con una propuesta lista para aceptar con ✓.',
    falta_subcuenta: 'Sin subcuenta: acepta la sugerencia, pide la IA o elígela.', falta_centro: 'La subcuenta exige centro y no lo tienen.',
    por_confirmar: 'Subcuenta o centro sugeridos: confirma con ✓.', imputada: 'Subcuenta y centro confirmados.', sin_cuenta: 'Cayeron en la cuenta Pendientes.', todos: 'Todas las facturas del período elegido.',
  },
  banco: {
    trabajo: 'Líneas que aún necesitan algo: subcuenta, centro, respaldo o factura vinculada.', sin_clasificar: 'Sin subcuenta.',
    sin_ceco: 'Con subcuenta que exige centro de costo, pero sin centro.', por_conciliar: 'Pagos de factura que aún no tienen la factura vinculada.',
    sugerencia: 'Líneas donde el motor propone subcuenta y centro.', revisar: 'La segunda opinión del historial discrepa de lo actual.',
    conciliado: 'Clasificadas y con respaldo completo.', todos: 'Todas las líneas del período.',
  },
}
export const ayudaChip = (pantalla, k) => AYUDAS_CHIP[pantalla]?.[k] ?? ''

const clave = k => `guia_cerrada:${k}`

export function GuiaPantalla({ clave: k, siguiente }) {
  const g = GUIAS[k]
  const [cerrada, setCerrada] = useState(() => { try { return localStorage.getItem(clave(k)) === '1' } catch { return false } })
  if (!g) return null
  const toggle = () => setCerrada(c => { try { localStorage.setItem(clave(k), c ? '0' : '1') } catch { /* sin almacenamiento */ } return !c })
  const glosario = [...(g.glosario ?? []), ...GLOSARIO_BASE]
  return (
    <div style={{ background: '#F0F6FF', border: '1px solid #C7D9F5', borderRadius: 8, padding: cerrada ? '6px 12px' : '10px 14px', fontSize: 12, color: INK }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ color: NAVY, fontSize: 12.5 }} title={g.intro}>📘 Cómo trabajar aquí · {g.titulo}</b>
        {siguiente && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fff', border: `1px solid ${BORDE}`, borderRadius: 999, padding: '3px 6px 3px 12px' }}
            title="Lo que más conviene hacer ahora, según los datos de la pantalla">
            <span style={{ fontSize: 11.5 }}><b style={{ color: VERDE }}>Siguiente paso:</b> {siguiente.texto}</span>
            {siguiente.accion && <button onClick={siguiente.onClick} style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: VERDE, border: 'none', borderRadius: 999, padding: '3px 10px', cursor: 'pointer' }}>{siguiente.accion}</button>}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={toggle} title={cerrada ? 'Mostrar los pasos, la leyenda y el glosario' : 'Ocultar la guía (se recuerda en este navegador)'}
          style={{ fontSize: 11, border: `1px solid ${BORDE}`, background: '#fff', borderRadius: 6, padding: '3px 9px', cursor: 'pointer', color: NAVY }}>
          {cerrada ? 'Mostrar guía' : 'Ocultar guía'}
        </button>
      </div>
      {!cerrada && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1.4fr) minmax(220px, 1fr) minmax(220px, 1fr)', gap: 14, marginTop: 8 }}>
          <div>
            <div style={{ fontSize: 11.5, color: SLATE, marginBottom: 6 }}>{g.intro}</div>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {g.pasos.map((p, i) => <li key={i} title={p} style={{ lineHeight: 1.35 }}>{p}</li>)}
            </ol>
          </div>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Leyenda</div>
            {g.leyenda.length === 0 && <div style={{ fontSize: 11.5, color: SLATE }}>Sin estados especiales en esta vista.</div>}
            {g.leyenda.map(e => (
              <div key={e.nombre} title={`${e.nombre}: ${e.texto}`} style={{ display: 'flex', gap: 6, alignItems: 'baseline', lineHeight: 1.3, marginBottom: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: e.color, whiteSpace: 'nowrap' }}>{e.nombre}</span>
                <span style={{ fontSize: 11.5, color: INK }}>{e.texto}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Glosario</div>
            <div style={{ maxHeight: 150, overflow: 'auto', paddingRight: 4 }}>
              {glosario.map(t => (
                <div key={t.termino} title={`${t.termino}: ${t.texto}`} style={{ lineHeight: 1.3, marginBottom: 2 }}>
                  <b style={{ fontSize: 11 }}>{t.termino}:</b> <span style={{ fontSize: 11.5, color: INK }}>{t.texto}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
