// src/rrhh/desempeno/DesempenoApp.jsx
// Evaluación de Desempeño — Outlet de Puertas
// 3 dimensiones ponderables por proceso:
//   1) Técnica (jefatura): cuestionario BARS + batería de control de sesgo
//   2) Formal (AUTOMÁTICA): puntualidad y asistencia VALIDADA (fn_eval_asistencia: mismo criterio que la pre-nómina)
//   3) Recomendación de continuidad (jefatura, con justificación)
// Resultado ponderado + informe exportable a PDF.
// v2 (20-11-2026, solicitud de Gestión de Personas): firmas con nombre, cargo y RUT;
// declaración, fecha y comentarios de la retroalimentación; plan de mejora en el
// documento; antecedentes del período; evidencia obligatoria en nota 2 con no
// continuidad; corrector ortográfico local; corrección/devolución por Gestión de
// Personas; y criterio v2 de la Dimensión 2 (tolerancia del Reglamento Interno,
// errores de marcaje y días previos al enrolamiento en el reloj).
// v3 (23-11-2026): cierre de procesos (las jefaturas solo ven los abiertos), universo
// evaluable (Dirección y socios fuera), tope mensual del art. 27 en la puntualidad e
// informe PDF con logo y colores corporativos.

import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../supabase'
import { preloadCaps, canSync } from '../../core/permisos'
import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { LOGO_B64 } from '../../logistica/logo_b64'

// Roles que ven todo el módulo sin pasar por capabilities.
// Espejo de ROLES_LEGADO_RRHH en RrhhApp.jsx — si cambia allá, cambiar acá,
// o esos roles entrarían al módulo y no verían a nadie.
const ROLES_ALCANCE_TOTAL = ['admin','dir_general','dir_finanzas']

// ─── Escala (del instrumento original, con anclas conductuales) ───────────────
const ESCALA = [
  { v:1, l:'Deficiente',       d:'No cumple con lo esperado para el cargo' },
  { v:2, l:'Bajo lo esperado', d:'Cumple parcialmente y requiere apoyo constante' },
  { v:3, l:'Cumple',           d:'Realiza adecuadamente las funciones de su cargo' },
  { v:4, l:'Sobre lo esperado',d:'Desempeño superior al requerido' },
  { v:5, l:'Destacado',        d:'Sobresaliente; es un referente para el equipo' },
]

// ─── Dimensión 1: ítems con anclas conductuales (BARS) ────────────────────────
// Peso (w) = ponderación de cada competencia DENTRO del bloque técnico (suma 100).
// El "peso sobre el puntaje final" se deriva: w × pond_tecnica del proceso
// (ej. a 70% técnica → t1 pesa 12% × 70% = 8,4% del final). No se hardcodea el
// peso final para no romper procesos con otra ponderación. La nota técnica es un
// PROMEDIO PONDERADO por w (antes era promedio simple). Pesos definidos por
// Gestión de Personas (Rocío Jara).
const COMPETENCIAS = [
  { g:'Desempeño técnico', items:[
    { k:'t1', w:12, l:'Cumplimiento de las funciones del cargo',
      a1:'Deja tareas centrales sin ejecutar o mal ejecutadas de forma recurrente',
      a3:'Ejecuta las funciones del cargo sin observaciones relevantes',
      a5:'Ejecuta todas sus funciones y anticipa necesidades no pedidas' },
    { k:'t2', w:12, l:'Calidad del trabajo y control de errores',
      a1:'Sus errores generan retrabajos o reclamos frecuentes',
      a3:'Errores ocasionales que detecta y corrige a tiempo',
      a5:'Trabajo consistentemente sin errores; otros usan su trabajo como referencia' },
    { k:'t3', w:10, l:'Ritmo de trabajo y productividad',
      a1:'Requiere plazos extendidos o deja pendientes acumulados',
      a3:'Cumple los volúmenes y plazos normales del cargo',
      a5:'Rinde por sobre el estándar incluso en períodos de alta demanda' },
  ]},
  { g:'Aprendizaje y procedimientos', items:[
    { k:'t4', w:9, l:'Aprendizaje y aplicación de nuevas instrucciones',
      a1:'Hay que repetirle instrucciones varias veces; no las incorpora',
      a3:'Incorpora instrucciones nuevas con un refuerzo razonable',
      a5:'Aprende a la primera y ayuda a otros a incorporar lo nuevo' },
    { k:'t5', w:9, l:'Cumplimiento de procedimientos y normas internas (SOP)',
      a1:'Omite procedimientos aunque los conoce',
      a3:'Sigue los procedimientos establecidos',
      a5:'Sigue los procedimientos y propone mejoras fundadas' },
  ]},
  { g:'Autonomía y confiabilidad', items:[
    { k:'t6', w:9, l:'Autonomía en la ejecución',
      a1:'Necesita seguimiento constante para avanzar',
      a3:'Trabaja sin seguimiento en tareas habituales',
      a5:'Resuelve imprevistos por sí mismo dentro de su ámbito' },
    { k:'t7', w:9, l:'Responsabilidad sobre sus tareas y compromisos',
      a1:'Se desentiende de resultados o culpa a terceros',
      a3:'Responde por sus tareas y plazos',
      a5:'Asume resultados del equipo más allá de su tarea individual' },
    { k:'t8', w:9, l:'Confiabilidad para la operación diaria',
      a1:'La operación debe planificarse asumiendo que puede fallar',
      a3:'Se puede contar con él/ella en la operación normal',
      a5:'Es a quien se recurre cuando algo no puede fallar' },
  ]},
  { g:'Colaboración y conducta', items:[
    { k:'t9', w:7, l:'Disposición para trabajar con compañeros',
      a1:'Evita colaborar o entorpece el trabajo conjunto',
      a3:'Buena disposición en el trabajo conjunto habitual',
      a5:'Genera activamente buen trabajo en equipo; otros quieren trabajar con él/ella' },
    { k:'t10', w:7, l:'Colaboración en apoyo a otras tareas o áreas',
      a1:'Se niega o pone trabas cuando se requiere apoyo fuera de su tarea',
      a3:'Apoya cuando se le solicita',
      a5:'Se ofrece a apoyar sin que se le pida cuando ve necesidad' },
    { k:'t11', w:7, l:'Respeto hacia compañeros y jefaturas',
      a1:'Tratos irrespetuosos o descalificaciones registradas',
      a3:'Trato respetuoso y correcto',
      a5:'Su trato mejora el clima incluso en situaciones de tensión' },
  ]},
]
const ITEMS = COMPETENCIAS.flatMap(c => c.items)
const PESO_TOTAL_TEC = ITEMS.reduce((s,it)=>s+(it.w||0),0)  // = 100

// Nota técnica = promedio PONDERADO por el peso w de cada competencia.
// Recibe el objeto items de respuestas ({ t1:{p,ev}, ... }).
// Devuelve null si falta puntuar algún ítem.
function notaTecnicaPonderada(items) {
  if (!items) return null
  let acc = 0, pesoAcc = 0
  for (const it of ITEMS) {
    const p = items[it.k]?.p
    if (p == null) return null
    acc += p * (it.w||0)
    pesoAcc += (it.w||0)
  }
  return pesoAcc > 0 ? r2(acc/pesoAcc) : null
}
// Peso de una competencia sobre el puntaje FINAL, dado el % técnico del proceso.
const pesoFinalDe = (w, pondTecnica) => Math.round((w/PESO_TOTAL_TEC) * pondTecnica * 10) / 10

// ─── Batería de control de sesgo ──────────────────────────────────────────────
const FREC = ['Nunca','Rara vez','A veces','Frecuentemente','Siempre']
const CONTROL_TXT = {
  c_errores:  'Describe 2 errores o situaciones mal manejadas por el evaluado durante el período, con fecha aproximada. Todos cometemos errores: si no recuerdas ninguno, probablemente estás evaluando una impresión general y no el período real.',
  c_aportes:  'Describe 2 aportes o logros concretos del evaluado durante el período, con fecha aproximada.',
  c_rehacer:  'Otras personas deben revisar o rehacer partes de su trabajo',
  c_conflictos:'Ha protagonizado roces o conflictos que afectaron el clima del equipo',
  c_reemplazo:'Si renunciara mañana, ¿qué tan difícil sería reemplazar su desempeño actual?',
  c_recontratar:'Si hoy estuvieras formando tu equipo desde cero, ¿volverías a contratar a esta persona?',
  c_relacion: '¿Tienes con el evaluado una amistad cercana, parentesco o un conflicto personal previo?',
  c_periodo:  '¿Tu evaluación pondera el período completo, y no principalmente las últimas semanas?',
}
const REEMPLAZO = ['Muy fácil','Fácil','Ni fácil ni difícil','Difícil','Muy difícil']

// ─── Recomendación de continuidad (Dimensión 3) ───────────────────────────────
const RECOMS = [
  { k:'plena',          l:'Continuidad plena',            nota:5, c:'#34C759', d:'Recomiendo su continuidad sin condiciones' },
  { k:'con_plan',       l:'Continuidad con plan de mejora',nota:3, c:'#FF9500', d:'Recomiendo continuidad sujeta a un plan de mejora con plazos' },
  { k:'no_continuidad', l:'No continuidad',               nota:1, c:'#FF3B30', d:'No recomiendo su continuidad en la empresa' },
]

const CATEGORIAS = [
  { min:4.3, l:'Destacado',                          c:'#34C759' },
  { min:3.6, l:'Competente',                         c:'#0A84FF' },
  { min:2.9, l:'En desarrollo — con plan de mejora', c:'#FF9500' },
  { min:0,   l:'Insuficiente — revisar continuidad', c:'#FF3B30' },
]
const categoriaDe = n => CATEGORIAS.find(c => n >= c.min)

// ─── Plan de mejora, evidencia y antecedentes (v2, solicitud Gestión de Personas) ─
const CAT_PLAN = 'En desarrollo — con plan de mejora'
// Plan de mejora obligatorio cuando la recomendación es "continuidad con plan" o el resultado
// queda en "En desarrollo" (salvo que se recomiende no continuidad: ahí el plan no tiene objeto).
const planRequerido = (categoria, recom) => recom === 'con_plan' || (categoria === CAT_PLAN && recom !== 'no_continuidad')
const motivoPlan = (categoria, recom) => recom === 'con_plan'
  ? 'Obligatorio porque se recomienda continuidad con plan de mejora. Define 2 o 3 compromisos concretos y medibles.'
  : categoria === CAT_PLAN
    ? 'Obligatorio porque el resultado queda en la categoría "En desarrollo — con plan de mejora". Define 2 o 3 compromisos concretos y medibles.'
    : 'Opcional. Si se registra, queda en el informe que firma el trabajador.'
// Evidencia obligatoria: puntajes 1 y 5 siempre; el 2 cuando se recomienda no continuidad.
const requiereEvidencia = (p, recom) => p === 1 || p === 5 || (p === 2 && recom === 'no_continuidad')
const DECLARACION_TRAB = 'Declaro haber recibido retroalimentación sobre esta evaluación.'
const PLAN_CAMPOS = { conducta:'Conducta esperada', apoyo:'Apoyo de la jefatura', medicion:'Cómo se medirá' }
const compVacio = () => ({ conducta:'', apoyo:'', medicion:'', plazo:'' })
const PLAN_VACIO = () => ({ compromisos:[compVacio(), compVacio()], reevaluacion:'' })
const compConDatos = c => !!c && (Object.keys(PLAN_CAMPOS).some(k => String(c[k]||'').trim()) || !!c.plazo)
const planTieneDatos = p => !!p && ((p.compromisos || []).some(compConDatos) || !!p.reevaluacion)
function validarPlan(plan, hoy) {
  const comps = (plan?.compromisos || []).filter(compConDatos)
  if (comps.length < 2) return 'El plan de mejora requiere al menos 2 compromisos.'
  for (const [i, c] of comps.entries()) {
    if (Object.keys(PLAN_CAMPOS).some(k => String(c[k]||'').trim().length < 10) || !c.plazo)
      return `Compromiso ${i+1}: completa la conducta esperada, el apoyo de la jefatura y cómo se medirá (mín. 10 caracteres cada uno) y el plazo.`
    if (c.plazo < hoy) return `Compromiso ${i+1}: el plazo no puede ser anterior a hoy.`
  }
  if (!plan.reevaluacion) return 'Indica la fecha de reevaluación del plan de mejora.'
  const ultimoPlazo = comps.map(c => c.plazo).sort().pop()
  if (plan.reevaluacion < ultimoPlazo) return 'La fecha de reevaluación debe ser igual o posterior al último plazo comprometido.'
  return null
}
const TIPOS_ANT = [
  { k:'retroalimentacion',    l:'Retroalimentación' },
  { k:'amonestacion_verbal',  l:'Amonestación verbal' },
  { k:'amonestacion_escrita', l:'Amonestación escrita' },
  { k:'compromiso',           l:'Compromiso' },
  { k:'reconocimiento',       l:'Reconocimiento' },
  { k:'otro',                 l:'Otro' },
]
const tipoAntL = k => TIPOS_ANT.find(t => t.k === k)?.l || k
const COLOR_ANT = { retroalimentacion:'#0A84FF', amonestacion_verbal:'#FF9500', amonestacion_escrita:'#FF3B30', compromiso:'#AF52DE', reconocimiento:'#34C759' }
// Corrector ortográfico del navegador activo y en español en todos los textos
const ORTO = { spellCheck:true, lang:'es-CL', autoCapitalize:'sentences' }
// Nombres y cargos para documentos formales (Contaline los guarda en MAYÚSCULAS o mixtos)
const PARTICULAS = new Set(['de','del','la','las','los','y','e','da','van','von'])
const nomProp = s => String(s || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  .map((w, i) => (i > 0 && PARTICULAS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
const cargoProp = s => { const t = String(s || '').trim(); return t && t === t.toUpperCase() ? nomProp(t) : t }
// Nota final ponderada (misma fórmula que fn_eval_recalcular_formal en la base de datos)
function notaFinalDe(tec, formal, recomNota, proc) {
  const dims = [
    { nota: tec, pond: proc.pond_tecnica },
    { nota: formal, pond: proc.pond_formal },
    { nota: recomNota, pond: proc.pond_recom },
  ].filter(d => d.nota != null)
  const pt = dims.reduce((s, d) => s + d.pond, 0)
  return pt > 0 ? r2(dims.reduce((s, d) => s + Number(d.nota) * d.pond, 0) / pt) : null
}

// ─── Notas de la dimensión formal (brackets sobre datos reales) ───────────────
const notaPuntualidad = p => p>=95?5 : p>=90?4.5 : p>=85?4 : p>=78?3.5 : p>=70?3 : p>=60?2 : 1
const notaAsistencia  = p => p>=98?5 : p>=95?4.5 : p>=92?4 : p>=88?3.5 : p>=84?3 : p>=75?2 : 1

const fFecha = d => { if(!d) return '—'; const [y,m,dd]=String(d).slice(0,10).split('-'); return `${dd}-${m}-${y}` }
// Fecha de hoy en Chile (toISOString() es UTC: después de las 21:00 ya devolvía el día siguiente)
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone:'America/Santiago' })
const fechaCL = ts => ts ? new Date(ts).toLocaleDateString('en-CA', { timeZone:'America/Santiago' }) : null
const fFechaHora = s => {
  if (!s) return '—'
  const t = String(s)
  if (t.includes('T')) return new Date(t).toLocaleString('es-CL', { timeZone:'America/Santiago', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
  const [f, h] = t.split(' ')
  return `${fFecha(f)}${h ? ` ${h.slice(0,5)}` : ''}`
}
// Redondeo a 2 decimales con EPSILON (4.605 → 4.61), igual que round() de Postgres en el recálculo SQL
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const fmtN = v => v == null || v === '' ? '—' : Number(v).toFixed(2)
// Colores corporativos para el informe PDF (rojo #E2231A y naranjo #F5821F)
const ROJO = [226, 35, 26], NARANJO = [245, 130, 31], TINTA = [33, 37, 41]

// ─── Motor de alertas de sesgo ────────────────────────────────────────────────
function calcularAlertas(resp, ctx = {}) {
  const alertas = []
  const notas = ITEMS.map(it => resp.items?.[it.k]?.p).filter(n => n != null)
  if (notas.length === 0) return alertas
  const avg = notas.reduce((s,n)=>s+n,0) / notas.length
  const sd = Math.sqrt(notas.reduce((s,n)=>s+(n-avg)**2,0) / notas.length)
  const ctl = resp.control || {}

  if (avg >= 4.5 && sd < 0.5) alertas.push({ k:'halo', t:'Posible efecto halo', d:`Puntuación uniformemente alta (promedio ${r2(avg)}, dispersión ${r2(sd)}). Ninguna persona destaca por igual en todas las competencias.` })
  if (avg <= 2.0 && sd < 0.5) alertas.push({ k:'severidad', t:'Posible sesgo de severidad', d:`Puntuación uniformemente baja (promedio ${r2(avg)}). Revise si hay competencias donde el desempeño sí cumple.` })
  if (sd < 0.3 && avg > 2.0 && avg < 4.5) alertas.push({ k:'uniforme', t:'Puntuación sin matices', d:'Todos los ítems recibieron prácticamente la misma nota. Diferenciar fortalezas y debilidades hace la evaluación más útil.' })
  const t2 = resp.items?.t2?.p
  if (t2 >= 4 && (ctl.c_rehacer ?? 0) >= 4) alertas.push({ k:'contra_calidad', t:'Contradicción en calidad', d:`Calidad evaluada con ${t2}, pero declara que su trabajo debe rehacerse "${FREC[ctl.c_rehacer-1]}".` })
  const cond = Math.min(resp.items?.t9?.p ?? 5, resp.items?.t11?.p ?? 5)
  if (cond >= 4 && (ctl.c_conflictos ?? 0) >= 4) alertas.push({ k:'contra_conducta', t:'Contradicción en conducta', d:`Conducta evaluada alta, pero declara conflictos "${FREC[ctl.c_conflictos-1]}".` })
  if (avg >= 4.3 && (ctl.c_reemplazo ?? 5) <= 2) alertas.push({ k:'contra_reemplazo', t:'Contradicción de valor', d:'Puntuación alta pero declara que sería fácil de reemplazar. Una de las dos apreciaciones no refleja el desempeño real.' })
  if (ctl.c_recontratar === 'no' && avg >= 4) alertas.push({ k:'contra_recontrato', t:'Contradicción de recontratación', d:'No lo recontrataría pese a evaluar su desempeño sobre lo esperado. La justificación de continuidad debe explicar esta diferencia.' })
  if (ctl.c_recontratar === 'si' && avg <= 2.2) alertas.push({ k:'contra_recontrato2', t:'Contradicción de recontratación', d:'Sí lo recontrataría pese a evaluar su desempeño como deficiente.' })
  if (ctl.c_relacion === 'si') alertas.push({ k:'relacion', t:'Relación personal declarada', d:`El evaluador declara vínculo personal con el evaluado${ctl.c_relacion_det?`: "${ctl.c_relacion_det}"`:''}. Considerar contraparte en la revisión.` })
  if (ctl.c_periodo === 'no') alertas.push({ k:'recencia', t:'Sesgo de recencia declarado', d:'El evaluador reconoce que su evaluación pondera principalmente las últimas semanas y no el período completo.' })
  for (const it of ITEMS) {
    const r = resp.items?.[it.k]
    if (r && requiereEvidencia(r.p, ctx.recom) && String(r.ev||'').trim().length < 30)
      alertas.push({ k:`ev_${it.k}`, t: r.p === 2 ? 'Evidencia débil en puntaje bajo' : 'Evidencia débil en puntaje extremo',
        d:`"${it.l}" recibió ${r.p}${r.p === 2 ? ' con recomendación de no continuidad' : ''} con evidencia insuficiente.` })
  }
  // Coherencia entre la recomendación de la jefatura y el resultado ponderado
  if (ctx.recom && ctx.notaFinal != null) {
    const cat = categoriaDe(ctx.notaFinal)
    if (ctx.recom === 'plena' && cat.min === 0)
      alertas.push({ k:'contra_cat_plena', t:'Recomendación contraria al resultado', d:`Recomienda continuidad plena con resultado "${cat.l}" (${Number(ctx.notaFinal).toFixed(2)}). La justificación debe explicar la diferencia.` })
    if (ctx.recom === 'no_continuidad' && ctx.notaFinal >= 3.6)
      alertas.push({ k:'contra_cat_no', t:'Recomendación contraria al resultado', d:`Recomienda no continuidad con resultado "${cat.l}" (${Number(ctx.notaFinal).toFixed(2)}). La justificación debe explicar la diferencia.` })
  }
  return alertas
}

// ═══════════════════════════════════════════════════════════════════════════════
// embebido/sub/onSub: patrón del shell tipo Finanzas. sub = 'procesos' | 'trabajadores'
// (vistas raíz). Las vistas de detalle informan la raíz desde la que se llegó.
const RAIZ_DES = { procesos:'procesos', proceso:'procesos', trabajadores:'trabajadores', ficha:'trabajadores' }
export function DesempenoApp({ cu, onVolverHubRrhh, onCerrarSesion, embebido, sub, onSub }) {
  const [ruta, setRuta] = useState(() => ({ v: sub === 'trabajadores' ? 'trabajadores' : 'procesos' }))
  const primeraSub = useRef(true)
  useEffect(() => { if (primeraSub.current) { primeraSub.current = false; return } if ((sub === 'procesos' || sub === 'trabajadores') && RAIZ_DES[ruta.v] !== sub) setRuta({ v: sub }) }, [sub]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const r = RAIZ_DES[ruta.v]; if (r) onSub?.(r) }, [ruta.v]) // eslint-disable-line react-hooks/exhaustive-deps
  const [procesos, setProcesos] = useState([])
  const [cargando, setCarg] = useState(true)
  const [modalProc, setModalProc] = useState(false)
  const [cierre, setCierre] = useState(null)          // { proc, accion:'cerrar'|'reabrir' }
  const [msg, setMsg] = useState(null)
  const [alc, setAlc] = useState({ cargando:true })
  // ¿Es Gestión de Personas? Misma regla que la base de datos (fn_rrhh_es_gestor).
  // Habilita antecedentes, corrección de redacción, devolución y recálculo de la Dimensión 2.
  const [gestor, setGestor] = useState(false)
  useEffect(() => {
    let c = false
    ;(async () => { try { const { data } = await supabase.rpc('fn_rrhh_es_gestor'); if (!c) setGestor(data === true) } catch(e) { /* sin permisos de gestión */ } })()
    return () => { c = true }
  }, [cu?.id])

  // ═══ Alcance de visibilidad ══════════════════════════════════════════════
  // El scope_filter de la capability rrhh.desempeno define a quién ve cada uno:
  //   'all'                → todos (Gestión de Personas, admin, dirección)
  //   'equipo' | 'propio'  → solo su equipo directo del organigrama
  //   'sucursal'           → solo trabajadores de su sucursal
  // Se resuelve a una lista de cod_contaline permitidos (alc.codes).
  // codes === null significa sin restricción; codes === [] significa que no ve
  // a nadie. Ante cualquier falla se cae a [] — falla CERRADO, nunca abre.
  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        const info = await preloadCaps(cu, 'rrhh')
        if (cancel) return

        if (ROLES_ALCANCE_TOTAL.includes(cu?.rol)) {
          setAlc({ cargando:false, scope:'all', admin:true, codes:null }); return
        }
        const scope = canSync(cu, 'rrhh', 'rrhh.desempeno') || false
        if (scope === 'all') {
          setAlc({ cargando:false, scope:'all', admin:true, codes:null }); return
        }

        // cod_contaline propio: se resuelve antes de ramificar porque se usa
        // para excluirse a sí mismo en TODOS los scopes restringidos.
        // v_org_equipo devuelve al jefe dentro de su propio equipo, así que sin
        // esta exclusión podría autoevaluarse y emitir un informe con firma.
        let miCod = cu?.cod_contaline ?? null
        if (miCod == null) {
          const { data } = await supabase.from('usuarios')
            .select('cod_contaline').eq('id', cu.id).maybeSingle()
          miCod = data?.cod_contaline ?? null
        }
        if (cancel) return

        if (scope === 'sucursal') {
          const suc = info?.sucursal_id || null
          if (!suc) { setAlc({ cargando:false, scope, admin:false, codes:[], motivo:'sin_sucursal' }); return }
          const { data } = await supabase.from('rrhh_empleados')
            .select('cod_contaline').eq('activo',true).eq('sucursal_id', suc)
          if (cancel) return
          const codes = [...new Set((data||[]).map(r=>r.cod_contaline).filter(c=>c!=null && c!==miCod))]
          setAlc({ cargando:false, scope, admin:false, sucursal:suc, miCod, codes,
            motivo: codes.length ? null : 'sin_equipo' })
          return
        }

        // 'equipo' | 'propio' → equipo directo vía organigrama
        if (miCod == null) {
          setAlc({ cargando:false, scope:scope||'equipo', admin:false, codes:[], motivo:'sin_enlace' }); return
        }
        const { data: eq } = await supabase.from('v_org_equipo')
          .select('cod_miembro').eq('cod_jefe', miCod)
        if (cancel) return
        const codes = [...new Set((eq||[]).map(r=>r.cod_miembro).filter(c=>c!=null && c!==miCod))]
        setAlc({ cargando:false, scope:scope||'equipo', admin:false, miCod, codes,
          motivo: codes.length ? null : 'sin_equipo' })
      } catch(e) {
        if (!cancel) setAlc({ cargando:false, scope:'equipo', admin:false, codes:[], motivo:'error' })
      }
    })()
    return () => { cancel = true }
  }, [cu?.id, cu?.rol])

  useEffect(() => { cargarProcesos() }, [])
  async function cargarProcesos() {
    setCarg(true)
    try {
      const { data, error } = await supabase.from('eval_procesos').select('*').order('created_at', {ascending:false})
      if (error) throw error
      setProcesos(data||[])
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
    finally { setCarg(false) }
  }

  return (
    <div style={{minHeight:embebido?undefined:'100vh',background:embebido?undefined:'var(--bg-app)'}}>
      {!embebido && <header style={{background:'var(--bg-surface)',borderBottom:'1px solid var(--border)',padding:'12px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:50}}>
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <button onClick={onVolverHubRrhh} style={btnSec}>&larr; Gestión de Personas</button>
          <div style={{fontSize:22}}>📋</div>
          <div>
            <div style={{fontSize:17,fontWeight:600}}>Evaluación de Desempeño</div>
            <div style={{fontSize:11,color:'var(--text-muted)'}}>3 dimensiones ponderadas · asistencia automática · control de sesgo</div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:13,fontWeight:600}}>{cu.nombre}</div>
          </div>
          <button onClick={onCerrarSesion} style={btnGhost}>Salir</button>
        </div>
      </header>}

      {msg && (
        <div style={{margin:embebido?'0 auto 12px':'12px 24px 0',maxWidth:embebido?1100:undefined,padding:'9px 14px',borderRadius:8,fontSize:13,
          background: msg.tipo==='error' ? '#FF3B3012' : '#34C75912',
          border: `1px solid ${msg.tipo==='error' ? '#FF3B3040' : '#34C75940'}`,
          display:'flex',justifyContent:'space-between'}}>
          <span>{msg.tipo==='error'?'⚠️':'✅'} {msg.txt}</span>
          <button onClick={()=>setMsg(null)} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-muted)'}}>✕</button>
        </div>
      )}

      <main style={{padding:embebido?0:24,maxWidth:1100,margin:'0 auto'}}>
        {alc.cargando ? (
          <div style={{padding:60,textAlign:'center',color:'var(--text-muted)'}}>Resolviendo alcance...</div>
        ) : alc.codes && alc.codes.length === 0 ? (
          <div style={{maxWidth:520,margin:'40px auto',textAlign:'center',background:'var(--bg-surface)',
            border:'1px solid var(--border)',borderRadius:16,padding:'36px 28px'}}>
            <div style={{fontSize:44,marginBottom:12}}>👥</div>
            <h3 style={{margin:'0 0 8px 0'}}>No tienes trabajadores asignados</h3>
            <p style={{color:'var(--text-muted)',fontSize:13,margin:0,lineHeight:1.5}}>
              {alc.motivo === 'sin_enlace'
                ? 'Tu usuario no está vinculado a una ficha de empleado, así que el sistema no puede determinar tu equipo. Pídele a Gestión de Personas que complete el vínculo.'
                : alc.motivo === 'sin_sucursal'
                ? 'Tu acceso no tiene sucursal asignada. Pídele a Gestión de Personas que la configure.'
                : alc.motivo === 'error'
                ? 'Hubo un problema al resolver tu equipo. Reintenta recargando la página; si persiste, avisa a Gestión de Personas.'
                : 'No tienes personas a cargo en el organigrama, por eso no hay evaluaciones que gestionar. Si esto no corresponde, avisa a Gestión de Personas.'}
            </p>
          </div>
        ) : (
        <>
        {!alc.admin && (
          <div style={{marginBottom:14,padding:'8px 13px',borderRadius:8,fontSize:12.5,
            background:'#007AFF10',border:'1px solid #007AFF35',color:'var(--text-muted)'}}>
            👥 Estás viendo únicamente a tu equipo directo ({alc.codes?.length ?? 0} persona{(alc.codes?.length ?? 0)===1?'':'s'}).
            La creación de procesos de evaluación la administra Gestión de Personas.
          </div>
        )}
        {!embebido && ['procesos','trabajadores'].includes(ruta.v) && (
          <div style={{display:'flex',gap:2,background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,padding:3,width:'fit-content',marginBottom:16}}>
            <button onClick={()=>setRuta({v:'trabajadores'})} style={{...tabBtn, ...(ruta.v==='trabajadores'?tabBtnOn:{})}}>👥 Trabajadores</button>
            <button onClick={()=>setRuta({v:'procesos'})} style={{...tabBtn, ...(ruta.v==='procesos'?tabBtnOn:{})}}>📋 Procesos</button>
          </div>
        )}
        {ruta.v === 'trabajadores' && (
          <VistaTrabajadores cu={cu} setMsg={setMsg} procesos={procesos} alc={alc} gestor={gestor}
            onFicha={(cod)=>setRuta({v:'ficha', cod})}
            onEvaluar={(proc, ev)=>setRuta({v:'form', proc, evalRow:ev})} />
        )}
        {ruta.v === 'ficha' && (
          <FichaTrabajador cod={ruta.cod} setMsg={setMsg} alc={alc} cu={cu} gestor={gestor}
            onVolver={()=>setRuta({v:'trabajadores'})}
            onInforme={(proc, ev)=>setRuta({v:'informe', proc, evalRow:ev, retorno:{v:'ficha', cod:ruta.cod}})} />
        )}
        {ruta.v === 'procesos' && (
          <VistaProcesos procesos={procesos} cargando={cargando} alc={alc} gestor={gestor}
            onNuevo={()=>setModalProc(true)} onAbrir={p=>setRuta({v:'proceso', proc:p})}
            onCerrar={p=>setCierre({ proc:p, accion:'cerrar' })} onReabrir={p=>setCierre({ proc:p, accion:'reabrir' })} />
        )}
        {ruta.v === 'proceso' && (
          <VistaProceso proc={ruta.proc} cu={cu} setMsg={setMsg} alc={alc}
            onVolver={()=>setRuta({v:'procesos'})}
            onEvaluar={(ev)=>setRuta({v:'form', proc:ruta.proc, evalRow:ev})}
            onInforme={(ev)=>setRuta({v:'informe', proc:ruta.proc, evalRow:ev})} />
        )}
        {ruta.v === 'form' && (
          <FormEvaluacion proc={ruta.proc} evalRow={ruta.evalRow} cu={cu} setMsg={setMsg}
            onVolver={()=>setRuta({v:'proceso', proc:ruta.proc})}
            onEnviada={(ev)=>setRuta({v:'informe', proc:ruta.proc, evalRow:ev, autoPdf:true})} />
        )}
        {ruta.v === 'informe' && (
          <InformeEvaluacion proc={ruta.proc} evalRow={ruta.evalRow} autoPdf={ruta.autoPdf} cu={cu} gestor={gestor} setMsg={setMsg}
            onVolver={()=>setRuta(ruta.retorno || {v:'proceso', proc:ruta.proc})} />
        )}
        </>
        )}
      </main>

      {modalProc && (
        <ModalProceso cu={cu}
          onCerrar={()=>setModalProc(false)}
          onCreado={async()=>{ setModalProc(false); await cargarProcesos() }} />
      )}
      {cierre && (
        <ModalCierreProceso proc={cierre.proc} accion={cierre.accion} cu={cu} setMsg={setMsg}
          onCerrar={()=>setCierre(null)}
          onHecho={async()=>{ setCierre(null); await cargarProcesos() }} />
      )}
    </div>
  )
}

// ─── Vista: lista de procesos ─────────────────────────────────────────────────
// Las jefaturas ven solo los procesos abiertos (no pueden evaluar en uno antiguo).
// Gestión de Personas ve también los cerrados y puede cerrar o reabrir.
function VistaProcesos({ procesos, cargando, onNuevo, onAbrir, alc, gestor, onCerrar, onReabrir }) {
  const admin = alc?.admin !== false   // sin alc (uso legado) → se comporta como antes
  const [verCerrados, setVerCerrados] = useState(false)
  const abiertos = procesos.filter(p => p.estado === 'abierto')
  const cerrados = procesos.filter(p => p.estado !== 'abierto')
  const visibles = gestor && verCerrados ? [...abiertos, ...cerrados] : abiertos
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:14}}>
        <div style={{fontSize:13,color:'var(--text-muted)'}}>
          <strong style={{color:'var(--text)',fontSize:15}}>{abiertos.length}</strong> proceso(s) abierto(s)
          {gestor && cerrados.length > 0 && (
            <button onClick={()=>setVerCerrados(v=>!v)} style={{...btnGhost,marginLeft:10,padding:'3px 10px',fontSize:11.5}}>
              {verCerrados ? 'Ocultar cerrados' : `Ver cerrados (${cerrados.length})`}
            </button>
          )}
        </div>
        {admin && <button onClick={onNuevo} style={btnPri}>➕ Nuevo proceso</button>}
      </div>
      {cargando ? <div style={{padding:60,textAlign:'center',color:'var(--text-muted)'}}>Cargando...</div> :
      visibles.length === 0 ? (
        <div style={{maxWidth:520,margin:'50px auto',textAlign:'center',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:'40px 28px'}}>
          <div style={{fontSize:48,marginBottom:12}}>📋</div>
          <h3 style={{margin:'0 0 6px 0'}}>{procesos.length ? 'No hay procesos abiertos' : 'Sin procesos de evaluación'}</h3>
          <p style={{color:'var(--text-muted)',fontSize:13,margin:'0 0 20px 0'}}>
            {admin
              ? 'Un proceso agrupa evaluaciones bajo un período y ponderaciones comunes (ej: "Paso a indefinido — Julio 2026" o "Evaluación anual 2026").'
              : 'Gestión de Personas todavía no ha abierto un proceso de evaluación. Cuando lo haga, tus evaluaciones pendientes aparecerán acá.'}
          </p>
          {admin && <button onClick={onNuevo} style={btnPri}>➕ Crear proceso</button>}
        </div>
      ) : (
        <div style={{display:'grid',gap:10}}>
          {visibles.map(p => {
            const cerrado = p.estado !== 'abierto'
            return (
              <div key={p.id} role='button' tabIndex={0} onClick={()=>onAbrir(p)} onKeyDown={e=>{ if (e.key === 'Enter') onAbrir(p) }}
                style={{display:'flex',alignItems:'center',gap:14,padding:'14px 18px',background:'var(--bg-surface)',
                  border:'1px solid var(--border)',borderRadius:12,cursor:'pointer',textAlign:'left',opacity:cerrado?0.72:1}}>
                <div style={{fontSize:24}}>{cerrado ? '🔒' : p.tipo==='indefinido'?'📄':p.tipo==='anual'?'📅':'🔄'}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14.5,fontWeight:700}}>{p.nombre}</div>
                  <div style={{fontSize:11.5,color:'var(--text-muted)',marginTop:2}}>
                    {fFecha(p.periodo_desde)} → {fFecha(p.periodo_hasta)} · Ponderación: técnica {p.pond_tecnica}% · formal {p.pond_formal}% · recomendación {p.pond_recom}%
                    {cerrado && p.cerrado_at ? ` · Cerrado el ${fFecha(fechaCL(p.cerrado_at))}` : ''}
                  </div>
                </div>
                <span style={{fontSize:10,fontWeight:800,padding:'3px 10px',borderRadius:100,
                  background: cerrado ? '#8E8E9320' : '#34C75918', color: cerrado ? '#8E8E93' : '#34C759'}}>
                  {cerrado ? 'CERRADO' : 'ABIERTO'}
                </span>
                {gestor && (cerrado
                  ? <button onClick={e=>{ e.stopPropagation(); onReabrir(p) }} style={{...btnSec,padding:'5px 12px',fontSize:11.5}}>Reabrir</button>
                  : <button onClick={e=>{ e.stopPropagation(); onCerrar(p) }} style={{...btnSec,padding:'5px 12px',fontSize:11.5}}>🔒 Cerrar</button>)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Modal: cerrar o reabrir un proceso (solo Gestión de Personas) ────────────
function ModalCierreProceso({ proc, accion, cu, setMsg, onCerrar, onHecho }) {
  const [evs, setEvs] = useState(null)
  const [g, setG] = useState(false)
  const cerrar = accion === 'cerrar'
  useEffect(() => { (async () => {
    const { data } = await supabase.from('eval_evaluaciones').select('id,cod_contaline,estado').eq('proceso_id', proc.id)
    const cods = [...new Set((data || []).map(e => e.cod_contaline))]
    const { data: em } = cods.length ? await supabase.from('rrhh_empleados').select('cod_contaline,nombre').in('cod_contaline', cods) : { data: [] }
    const nom = Object.fromEntries((em || []).map(e => [e.cod_contaline, e.nombre]))
    setEvs((data || []).map(e => ({ ...e, nombre: nom[e.cod_contaline] || `#${e.cod_contaline}` })))
  })() }, [proc.id])
  const borr = (evs || []).filter(e => e.estado === 'borrador')
  const env = (evs || []).filter(e => e.estado === 'enviada')
  async function confirmar() {
    setG(true)
    const { data, error } = await supabase.rpc(cerrar ? 'fn_eval_cerrar_proceso' : 'fn_eval_reabrir_proceso', { p_proceso_id: proc.id, p_usuario: cu?.id || null })
    setG(false)
    if (error || data?.error) { setMsg?.({ tipo:'error', txt: error?.message || data.error }); return }
    setMsg?.({ tipo:'ok', txt: cerrar ? `Proceso cerrado: ${data.enviadas} evaluación(es) enviada(s), ${data.descartadas} borrador(es) descartado(s).` : 'Proceso reabierto.' })
    onHecho()
  }
  return (
    <Overlay onCerrar={onCerrar}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>{cerrar ? '🔒 Cerrar proceso' : '🔓 Reabrir proceso'}</div>
      <div style={{fontSize:13,fontWeight:600,marginBottom:10}}>{proc.nombre} <span style={{fontWeight:400,color:'var(--text-muted)'}}>· {fFecha(proc.periodo_desde)} → {fFecha(proc.periodo_hasta)}</span></div>
      {cerrar ? (
        <>
          <div style={{fontSize:12,color:'var(--text-muted)',lineHeight:1.5,marginBottom:10}}>
            Al cerrarlo, las jefaturas dejan de verlo y nadie puede agregar ni enviar evaluaciones en él.
            Las evaluaciones enviadas y sus informes siguen disponibles para Gestión de Personas.
          </div>
          {!evs ? <div style={{fontSize:12.5,color:'var(--text-muted)'}}>Cargando…</div> : (
            <div style={{fontSize:12.5}}>
              <strong>{env.length}</strong> enviada(s) · <strong>{borr.length}</strong> borrador(es)
              {borr.length > 0 && (
                <div style={{...avisoS,marginTop:8}}>
                  Estos borradores quedarán descartados (queda registro de quién y cuándo):
                  <ul style={{margin:'6px 0 0 0',paddingLeft:18}}>{borr.map(b => <li key={b.id}>{b.nombre}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div style={{fontSize:12,color:'var(--text-muted)',lineHeight:1.5}}>
          Vuelve a quedar visible para las jefaturas y se puede evaluar en él. Los borradores que se descartaron al cerrarlo no se recuperan.
        </div>
      )}
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
        <button onClick={onCerrar} disabled={g} style={btnSec}>Cancelar</button>
        <button onClick={confirmar} disabled={g || (cerrar && !evs)} style={btnPri}>{g ? 'Procesando...' : cerrar ? 'Cerrar proceso' : 'Reabrir proceso'}</button>
      </div>
    </Overlay>
  )
}

// ─── Modal: nuevo proceso ─────────────────────────────────────────────────────
function ModalProceso({ cu, onCerrar, onCreado }) {
  const [form, setForm] = useState({
    nombre:'', tipo:'continuidad',
    desde: new Date(Date.now()-90*86400000).toISOString().slice(0,10),
    hasta: hoyISO(),
    pt:70, pf:30, pr:0,
  })
  const [guardando, setG] = useState(false)
  const [err, setErr] = useState(null)
  const suma = Number(form.pt)+Number(form.pf)+Number(form.pr)

  async function crear() {
    if (!form.nombre.trim()) { setErr('El nombre es obligatorio'); return }
    if (suma !== 100) { setErr(`Las ponderaciones deben sumar 100 (hoy: ${suma})`); return }
    setG(true); setErr(null)
    try {
      const { error } = await supabase.from('eval_procesos').insert({
        nombre: form.nombre.trim(), tipo: form.tipo,
        periodo_desde: form.desde, periodo_hasta: form.hasta,
        pond_tecnica: Number(form.pt), pond_formal: Number(form.pf), pond_recom: Number(form.pr),
        creado_por: cu.id,
      })
      if (error) throw error
      await onCreado()
    } catch(e) { setErr(e.message); setG(false) }
  }

  return (
    <Overlay onCerrar={onCerrar}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:14}}>➕ Nuevo proceso de evaluación</div>
      <div style={{display:'grid',gap:10,marginBottom:14}}>
        <div>
          <label style={lblM}>Nombre</label>
          <input value={form.nombre} onChange={e=>setForm(f=>({...f,nombre:e.target.value}))}
            placeholder='Ej: Paso a indefinido — Julio 2026' style={inpFull}/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
          <div>
            <label style={lblM}>Tipo</label>
            <select value={form.tipo} onChange={e=>setForm(f=>({...f,tipo:e.target.value}))} style={inpFull}>
              <option value='continuidad'>Continuidad</option>
              <option value='indefinido'>Paso a indefinido</option>
              <option value='anual'>Anual</option>
            </select>
          </div>
          <div><label style={lblM}>Período desde</label>
            <input type='date' value={form.desde} onChange={e=>setForm(f=>({...f,desde:e.target.value}))} style={inpFull}/></div>
          <div><label style={lblM}>Período hasta</label>
            <input type='date' value={form.hasta} onChange={e=>setForm(f=>({...f,hasta:e.target.value}))} style={inpFull}/></div>
        </div>
        <div>
          <label style={lblM}>Ponderaciones (deben sumar 100)</label>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
            {[['pt','Técnica jefatura'],['pf','Formal (asistencia)'],['pr','Recomendación']].map(([k,l])=>(
              <div key={k}>
                <div style={{fontSize:10.5,color:'var(--text-muted)',marginBottom:3}}>{l}</div>
                <input type='number' min='0' max='100' value={form[k]}
                  onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={inpFull}/>
              </div>
            ))}
          </div>
          <div style={{fontSize:11,marginTop:5,color: suma===100 ? 'var(--success,#34C759)' : '#FF3B30',fontWeight:600}}>
            Suma: {suma}/100
          </div>
        </div>
      </div>
      {err && <div style={{fontSize:12,color:'#FF3B30',marginBottom:12}}>⚠️ {err}</div>}
      <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
        <button onClick={onCerrar} disabled={guardando} style={btnSec}>Cancelar</button>
        <button onClick={crear} disabled={guardando} style={btnPri}>{guardando?'Creando...':'Crear proceso'}</button>
      </div>
    </Overlay>
  )
}

// ─── Vista: detalle de proceso (evaluaciones) ─────────────────────────────────
function VistaProceso({ proc, cu, setMsg, onVolver, onEvaluar, onInforme, alc }) {
  const [evals, setEvals] = useState([])
  const [emps, setEmps] = useState([])
  const [cargando, setCarg] = useState(true)
  const [busq, setBusq] = useState('')
  const [agregando, setAgregando] = useState(false)

  useEffect(() => { cargar() }, [proc.id, alc?.codes])
  async function cargar() {
    setCarg(true)
    try {
      // El filtro va en la consulta, no en el render: así los datos de personas
      // fuera del alcance nunca llegan al navegador. [-1] es centinela para
      // lista vacía (cod_contaline es integer, nunca negativo).
      const permitidos = alc?.codes ? (alc.codes.length ? alc.codes : [-1]) : null
      let qEv = supabase.from('eval_evaluaciones').select('*').eq('proceso_id', proc.id).neq('estado', 'descartada').order('created_at')
      // Fichas de todos los estados (no solo activos): la evaluación de alguien que ya
      // egresó debe seguir mostrando su nombre y sucursal (antes salía como "#114").
      let qEm = supabase.from('rrhh_empleados').select('cod_contaline,nombre,rut,sucursal_id,cargo,activo,fecha_egreso,fusionada_en,evaluable').order('nombre')
      if (permitidos) { qEv = qEv.in('cod_contaline', permitidos); qEm = qEm.in('cod_contaline', permitidos) }
      const [ev, em] = await Promise.all([qEv, qEm])
      if (ev.error) throw ev.error
      setEvals(ev.data||[]); setEmps(em.data||[])
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
    finally { setCarg(false) }
  }

  const empPorCod = useMemo(()=>Object.fromEntries(emps.map(e=>[e.cod_contaline,e])),[emps])
  const yaEval = new Set(evals.map(e=>e.cod_contaline))
  const candidatos = useMemo(() => {
    const q = busq.trim().toLowerCase()
    if (!q) return []
    return emps.filter(e=>e.activo && e.fusionada_en == null && e.evaluable !== false && !yaEval.has(e.cod_contaline))
      .filter(e=>String(e.nombre||'').toLowerCase().includes(q)||String(e.rut||'').includes(q)).slice(0,6)
  }, [busq, emps, evals])

  // Seguimiento del proceso para Gestión de Personas
  const resumen = useMemo(() => {
    const env = evals.filter(e=>e.estado==='enviada')
    return {
      env: env.length,
      retro: env.filter(e=>e.retro_fecha).length,
      planPend: env.filter(e=>planRequerido(e.categoria, e.recomendacion) && !planTieneDatos(e.plan_mejora)).length,
      verificar: env.filter(e=>(e.asis_snapshot?.atrasosExtremos||0) > 0).length,
      devueltas: evals.filter(e=>e.estado!=='enviada' && (e.devoluciones||[]).length > 0).length,
    }
  }, [evals])

  async function agregarEval(emp) {
    setAgregando(true)
    try {
      const { data, error } = await supabase.from('eval_evaluaciones').insert({
        proceso_id: proc.id, cod_contaline: emp.cod_contaline, evaluador_id: cu.id,
      }).select().single()
      if (error) throw error
      setBusq('')
      onEvaluar(data)
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
    finally { setAgregando(false) }
  }

  return (
    <div>
      <button onClick={onVolver} style={{...btnSec,marginBottom:14}}>&larr; Procesos</button>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 18px',marginBottom:14}}>
        <div style={{fontSize:16,fontWeight:800}}>{proc.nombre}</div>
        <div style={{fontSize:12,color:'var(--text-muted)',marginTop:3}}>
          Período evaluado: {fFecha(proc.periodo_desde)} → {fFecha(proc.periodo_hasta)} ·
          Técnica {proc.pond_tecnica}% · Formal {proc.pond_formal}% · Recomendación {proc.pond_recom}%
        </div>
      </div>

      {proc.estado === 'cerrado' ? (
        <div style={{fontSize:12.5,background:'#8E8E9314',border:'1px solid #8E8E9340',borderLeft:'3px solid #8E8E93',borderRadius:8,padding:'9px 12px',marginBottom:14}}>
          🔒 Proceso cerrado{proc.cerrado_at ? ` el ${fFecha(fechaCL(proc.cerrado_at))}` : ''}: solo lectura. Las evaluaciones enviadas y sus informes siguen disponibles.
        </div>
      ) : (
      <div style={{marginBottom:14}}>
        <label style={lblM}>Agregar trabajador a evaluar</label>
        <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder='Buscar por nombre o RUT...' style={{...inpFull,maxWidth:420}}/>
        {busq.trim() && (
          <div style={{display:'flex',flexDirection:'column',gap:4,marginTop:6,maxWidth:420}}>
            {candidatos.length===0 && <div style={{fontSize:12,color:'var(--text-muted)',padding:6}}>Sin coincidencias (o ya está en el proceso)</div>}
            {candidatos.map(e=>(
              <button key={e.cod_contaline} onClick={()=>agregarEval(e)} disabled={agregando}
                style={{display:'flex',justifyContent:'space-between',padding:'8px 11px',background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',textAlign:'left'}}>
                <span style={{fontSize:12.5,fontWeight:600}}>{e.nombre}</span>
                <span style={{fontSize:11,color:'var(--text-muted)'}}>{e.sucursal_id||''} {e.cargo?`· ${e.cargo}`:''}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {!cargando && evals.length > 0 && (
        <div style={{display:'flex',gap:16,flexWrap:'wrap',fontSize:12,color:'var(--text-muted)',marginBottom:8}}>
          <span><strong style={{color:'var(--text)'}}>{resumen.env}</strong> de {evals.length} enviadas</span>
          <span><strong style={{color:'var(--text)'}}>{resumen.retro}</strong> con retroalimentación registrada</span>
          {resumen.planPend > 0 && <span style={{color:'#FF9500',fontWeight:600}}>{resumen.planPend} plan(es) de mejora pendiente(s)</span>}
          {resumen.verificar > 0 && <span style={{color:'#FF9500',fontWeight:600}} title='Atrasos de más de 2 horas con entrada y salida marcadas: verificar el turno asignado'>{resumen.verificar} con atrasos extremos por verificar</span>}
          {resumen.devueltas > 0 && <span style={{color:'#FF3B30',fontWeight:600}}>{resumen.devueltas} devuelta(s) a la jefatura</span>}
        </div>
      )}

      {cargando ? <div style={{padding:40,textAlign:'center',color:'var(--text-muted)'}}>Cargando...</div> :
      evals.length === 0 ? (
        <div style={{padding:'30px 0',textAlign:'center',color:'var(--text-muted)',fontSize:13}}>Aún no hay evaluaciones en este proceso.</div>
      ) : (
        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,minWidth:820}}>
            <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
              {['Trabajador','Sucursal','Estado','Nota final','Categoría','Retro.','Alertas',''].map(h=>(
                <th key={h} style={thS}>{h}</th>))}
            </tr></thead>
            <tbody>
              {evals.map(ev => {
                const emp = empPorCod[ev.cod_contaline]
                const enviada = ev.estado === 'enviada'
                const devuelta = !enviada && (ev.devoluciones||[]).length > 0
                const cat = enviada && ev.nota_final != null ? categoriaDe(Number(ev.nota_final)) : null
                const nAl = (ev.alertas||[]).length
                const exPlan = enviada && planRequerido(ev.categoria, ev.recomendacion)
                const nExt = enviada ? (ev.asis_snapshot?.atrasosExtremos || 0) : 0
                return (
                  <tr key={ev.id} style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={tdS}>
                      <strong>{emp?.nombre || `#${ev.cod_contaline}`}</strong>
                      {emp && emp.activo === false && <span style={badgeEgr}>EGRESADO{emp.fecha_egreso ? ` ${fFecha(emp.fecha_egreso)}` : ''}</span>}
                    </td>
                    <td style={tdS}>{emp?.sucursal_id || '—'}</td>
                    <td style={tdS}>
                      <span style={{fontSize:10,fontWeight:800,padding:'2px 9px',borderRadius:100,
                        background: enviada ? '#34C75918' : devuelta ? '#FF3B3018' : '#FF950018',
                        color: enviada ? '#34C759' : devuelta ? '#FF3B30' : '#FF9500'}}>
                        {enviada ? 'ENVIADA' : devuelta ? 'DEVUELTA' : 'BORRADOR'}
                      </span>
                    </td>
                    <td style={{...tdS,fontWeight:800,fontSize:14}}>{enviada && ev.nota_final != null ? Number(ev.nota_final).toFixed(2) : '—'}</td>
                    <td style={tdS}>
                      {cat ? <span style={{color:cat.c,fontWeight:700,fontSize:11.5}}>{cat.l}</span> : '—'}
                      {exPlan && (
                        <div style={{fontSize:10.5,marginTop:2,fontWeight:600,color: planTieneDatos(ev.plan_mejora) ? 'var(--text-muted)' : '#FF9500'}}>
                          {planTieneDatos(ev.plan_mejora) ? `Plan de mejora · reeval. ${fFecha(ev.plan_reevaluacion)}` : 'Plan de mejora pendiente'}
                        </div>
                      )}
                    </td>
                    <td style={{...tdS,fontSize:11.5,whiteSpace:'nowrap'}}>
                      {!enviada ? '—' : ev.retro_fecha
                        ? <span style={{color:'#34C759',fontWeight:700}}>✓ {fFecha(ev.retro_fecha)}</span>
                        : <span style={{color:'var(--text-muted)'}}>Pendiente</span>}
                    </td>
                    <td style={{...tdS,whiteSpace:'nowrap'}}>
                      {nAl > 0 ? <span style={{color:'#FF9500',fontWeight:700}} title='Alertas de objetividad'>⚠️ {nAl}</span> : enviada ? '✓' : '—'}
                      {nExt > 0 && <span title={`${nExt} atraso(s) de más de 2 h con entrada y salida marcadas: verificar el turno asignado`} style={{marginLeft:8,color:'#FF9500',fontWeight:700,fontSize:11}}>⏱ {nExt}</span>}
                    </td>
                    <td style={{...tdS,textAlign:'right'}}>
                      {!enviada
                        ? (proc.estado === 'cerrado' ? <span style={{fontSize:11,color:'var(--text-muted)'}}>—</span>
                          : <button onClick={()=>onEvaluar(ev)} style={{...btnPri,padding:'5px 12px',fontSize:12}}>{devuelta ? 'Corregir' : 'Evaluar'}</button>)
                        : <button onClick={()=>onInforme(ev)} style={{...btnSec,padding:'5px 12px',fontSize:12}}>📄 Informe</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Formulario de evaluación ─────────────────────────────────────────────────
function FormEvaluacion({ proc, evalRow, cu, setMsg, onVolver, onEnviada }) {
  const [emp, setEmp] = useState(null)
  const [resp, setResp] = useState(evalRow.respuestas && Object.keys(evalRow.respuestas).length ? evalRow.respuestas : { items:{}, control:{} })
  const [recom, setRecom] = useState(evalRow.recomendacion || null)
  const [justif, setJustif] = useState(evalRow.justificacion || '')
  const [plan, setPlan] = useState(() => evalRow.plan_mejora?.compromisos?.length ? evalRow.plan_mejora : PLAN_VACIO())
  const [verPlan, setVerPlan] = useState(() => planTieneDatos(evalRow.plan_mejora))
  const [asis, setAsis] = useState(null)      // métricas del período
  const [ants, setAnts] = useState(null)      // antecedentes del período (los registra Gestión de Personas)
  const [orto, setOrto] = useState(null)      // revisión ortográfica abierta: { modo:'envio' | 'manual' }
  const [guardando, setG] = useState(false)
  const [revisando, setRevisando] = useState(false)
  const [err, setErr] = useState(null)
  const devolucion = (evalRow.devoluciones || []).slice(-1)[0] || null

  useEffect(() => { cargarContexto() }, [evalRow.id])
  async function cargarContexto() {
    try {
      // Dimensión 2 con asistencia VALIDADA (mismo criterio que la pre-nómina) + criterio v2:
      // tolerancia del Reglamento Interno, errores de marcaje y días previos al enrolamiento.
      const [e, j, an] = await Promise.all([
        supabase.from('rrhh_empleados').select('*').eq('cod_contaline', evalRow.cod_contaline).single(),
        supabase.rpc('fn_eval_asistencia', { p_cod: evalRow.cod_contaline, p_desde: proc.periodo_desde, p_hasta: proc.periodo_hasta }),
        supabase.from('rrhh_antecedentes').select('id,fecha,tipo,motivo').eq('cod_contaline', evalRow.cod_contaline).eq('activo', true)
          .gte('fecha', proc.periodo_desde).lte('fecha', proc.periodo_hasta).order('fecha'),
      ])
      setEmp(e.data)
      setAnts(an.error ? [] : (an.data || []))
      if (j.error) throw j.error
      const a = j.data || { sinDatos:true }
      if (a.sinDatos) { setAsis({ ...a, sinDatos:true }); return }
      setAsis({ ...a, nota: Number(a.nota), notaP: a.notaP != null ? Number(a.notaP) : null, notaA: Number(a.notaA) })
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
  }

  const setItem = (k, campo, val) => setResp(r=>({ ...r, items:{ ...r.items, [k]: { ...(r.items?.[k]||{}), [campo]: val } } }))
  const setCtl  = (k, val) => setResp(r=>({ ...r, control:{ ...(r.control||{}), [k]: val } }))
  const ctl = resp.control || {}

  const notasItems = ITEMS.map(it=>resp.items?.[it.k]?.p).filter(n=>n!=null)
  const notaTec = notaTecnicaPonderada(resp.items)
  const notaRecom = recom ? RECOMS.find(r=>r.k===recom).nota : null

  const notaFinal = useMemo(() => {
    if (notaTec == null || notaRecom == null) return null
    return notaFinalDe(notaTec, asis && !asis.sinDatos ? asis.nota : null, notaRecom, proc)
  }, [notaTec, notaRecom, asis, proc])
  const catProy = notaFinal != null ? categoriaDe(notaFinal) : null
  const exigePlan = planRequerido(catProy?.l, recom)
  const mostrarPlan = exigePlan || verPlan
  const planGuardable = planTieneDatos(plan) ? plan : null

  // Textos que revisa el corrector ortográfico (cada uno con su setter, para corregir desde el modal)
  const camposTexto = () => {
    const c = []
    for (const it of ITEMS) {
      const r = resp.items?.[it.k]
      if (r?.ev) c.push({ id:`ev_${it.k}`, l:`Evidencia · ${it.l}`, texto:r.ev, set:v=>setItem(it.k,'ev',v) })
    }
    if (ctl.c_errores) c.push({ id:'c_errores', l:'Errores del período', texto:ctl.c_errores, set:v=>setCtl('c_errores',v) })
    if (ctl.c_aportes) c.push({ id:'c_aportes', l:'Aportes del período', texto:ctl.c_aportes, set:v=>setCtl('c_aportes',v) })
    if (ctl.c_relacion_det) c.push({ id:'c_relacion_det', l:'Relación personal declarada', texto:ctl.c_relacion_det, set:v=>setCtl('c_relacion_det',v) })
    if (justif) c.push({ id:'justif', l:'Justificación de la recomendación', texto:justif, set:setJustif })
    if (mostrarPlan) (plan.compromisos || []).forEach((cp, i) => Object.keys(PLAN_CAMPOS).forEach(k => {
      if (cp[k]) c.push({ id:`plan_${i}_${k}`, l:`Plan de mejora · compromiso ${i+1} · ${PLAN_CAMPOS[k]}`, texto:cp[k],
        set:v=>setPlan(p=>({ ...p, compromisos:(p.compromisos||[]).map((x,j)=>j===i?{ ...x, [k]:v }:x) })) })
    }))
    return c
  }

  async function guardarBorrador() {
    setG(true); setErr(null)
    try {
      const { error } = await supabase.from('eval_evaluaciones').update({
        respuestas: resp, recomendacion: recom, justificacion: justif || null,
        plan_mejora: planGuardable, plan_reevaluacion: planGuardable?.reevaluacion || null,
        updated_at: new Date().toISOString(),
      }).eq('id', evalRow.id)
      if (error) throw error
      setMsg({tipo:'ok', txt:'Borrador guardado'})
    } catch(e) { setErr(e.message) }
    finally { setG(false) }
  }

  async function enviar(opts = {}) {
    // Validaciones duras
    const faltan = ITEMS.filter(it => resp.items?.[it.k]?.p == null)
    if (faltan.length) { setErr(`Faltan ${faltan.length} ítem(s) por puntuar en la dimensión técnica.`); return }
    for (const it of ITEMS) {
      const r = resp.items[it.k]
      if (requiereEvidencia(r.p, recom) && String(r.ev||'').trim().length < 20) {
        setErr(r.p === 2
          ? `"${it.l}" tiene nota 2 y recomiendas no continuidad: describe la evidencia concreta que la respalda (mín. 20 caracteres).`
          : `"${it.l}" tiene puntaje extremo (${r.p}): describe la evidencia concreta que lo respalda (mín. 20 caracteres).`)
        return
      }
    }
    if (String(ctl.c_errores||'').trim().length < 30) { setErr('Control de sesgo: describe los 2 errores del período (mín. 30 caracteres). Si evalúas alto y no recuerdas ninguno, revisa tu evaluación.'); return }
    if (String(ctl.c_aportes||'').trim().length < 30) { setErr('Control de sesgo: describe los 2 aportes concretos del período (mín. 30 caracteres).'); return }
    for (const k of ['c_rehacer','c_conflictos','c_reemplazo']) if (ctl[k] == null) { setErr('Responde toda la batería de control de sesgo.'); return }
    for (const k of ['c_recontratar','c_relacion','c_periodo']) if (!ctl[k]) { setErr('Responde toda la batería de control de sesgo.'); return }
    if (!recom) { setErr('Selecciona la recomendación de continuidad.'); return }
    if (String(justif||'').trim().length < 80) { setErr('La justificación de la recomendación es obligatoria (mín. 80 caracteres): fundamenta con hechos del período.'); return }
    if (ctl.c_relacion === 'si' && String(ctl.c_relacion_det||'').trim().length < 5) { setErr('Declaraste una relación personal: especifica cuál.'); return }
    if (!asis) { setErr('Todavía se está calculando la asistencia del período (Dimensión 2). Espera unos segundos e intenta de nuevo.'); return }
    if (exigePlan || planTieneDatos(plan)) {
      const e = validarPlan(plan, hoyISO())
      if (e) { setErr(exigePlan ? e : `Plan de mejora (opcional): ${e} Complétalo o quítalo.`); return }
    }

    // Revisión ortográfica antes de enviar: el trabajador firma este documento.
    if (!opts.sinOrtografia) {
      setRevisando(true); setErr(null)
      let hallazgos = null
      try {
        const m = await import('./ortografia')
        const sp = await m.cargarCorrector()
        hallazgos = m.revisarCampos(sp, camposTexto())
      } catch(e) { console.warn('Corrector ortográfico no disponible:', e) }
      setRevisando(false)
      if (hallazgos && hallazgos.length) { setOrto({ modo:'envio' }); return }
    }
    setOrto(null)

    const alertas = calcularAlertas(resp, { recom, notaFinal })
    const notaFormalFinal = asis && !asis.sinDatos ? asis.nota : null
    const snapshot = asis && !asis.sinDatos ? asis : { ...(asis||{}), sinDatos:true }
    const cat = categoriaDe(notaFinal)

    setG(true); setErr(null)
    try {
      const { data, error } = await supabase.from('eval_evaluaciones').update({
        respuestas: resp, alertas,
        nota_tecnica: notaTec,
        asis_snapshot: snapshot, nota_formal: notaFormalFinal,
        recomendacion: recom, justificacion: justif.trim(), nota_recom: notaRecom,
        nota_final: notaFinal, categoria: cat.l,
        plan_mejora: planGuardable, plan_reevaluacion: planGuardable?.reevaluacion || null,
        enviada_por: cu.id,                       // firma como jefatura evaluadora quien envía
        estado: 'enviada', enviada_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', evalRow.id).select().single()
      if (error) throw error
      onEnviada(data)
    } catch(e) { setErr(e.message); setG(false) }
  }

  return (
    <div style={{maxWidth:860,margin:'0 auto'}}>
      <button onClick={onVolver} style={{...btnSec,marginBottom:14}}>&larr; Volver al proceso</button>

      {devolucion && evalRow.estado !== 'enviada' && (
        <div style={{fontSize:12,lineHeight:1.5,background:'#FF3B3008',border:'1px solid #FF3B3030',borderLeft:'3px solid #FF3B30',borderRadius:8,padding:'8px 12px',marginBottom:14}}>
          <strong>Devuelta por Gestión de Personas</strong> el {fFechaHora(devolucion.at)}{devolucion.por_nombre ? ` (${devolucion.por_nombre})` : ''}: {devolucion.motivo}
          <div style={{fontSize:11.5,color:'var(--text-muted)',marginTop:4}}>Corrige lo indicado y vuelve a enviar. La Dimensión 2 se recalcula al enviar.</div>
        </div>
      )}

      {/* Cabecera del evaluado */}
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 18px',marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
          <div>
            <div style={{fontSize:16,fontWeight:800}}>{emp?.nombre || '...'}</div>
            <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>
              {emp?.cargo || 'Sin cargo'} · {emp?.sucursal_id || '—'} · RUT {emp?.rut || '—'} · Evaluador: {cu.nombre}
            </div>
          </div>
          <div style={{textAlign:'right',fontSize:12,color:'var(--text-muted)'}}>
            {proc.nombre}<br/>{fFecha(proc.periodo_desde)} → {fFecha(proc.periodo_hasta)}
          </div>
        </div>
        <div style={{fontSize:11.5,color:'var(--text-muted)',marginTop:10,padding:'8px 11px',background:'var(--bg-app)',borderRadius:8}}>
          Evalúa <strong>hechos observables del período completo</strong>, no impresiones generales ni el último mes.
          Los puntajes 1 y 5 exigen evidencia concreta, y también el 2 si recomiendas no continuidad. Las preguntas de control detectan inconsistencias y quedan
          registradas en el informe — responde con honestidad, no penalizan: dan credibilidad a tu evaluación.
          El trabajador firma este informe: antes de enviar se revisa la ortografía de los textos.
        </div>
      </div>

      {/* Riel de progreso — guía visual del recorrido */}
      <ProgressRail
        notaTec={notaTec} notaFinal={notaFinal}
        itemsDone={notasItems.length} itemsTotal={ITEMS.length}
        ctlDone={['c_errores','c_aportes'].filter(k=>String(ctl[k]||'').trim().length>=30).length
               + ['c_rehacer','c_conflictos','c_reemplazo'].filter(k=>ctl[k]!=null).length
               + ['c_recontratar','c_relacion','c_periodo'].filter(k=>!!ctl[k]).length}
        ctlTotal={8}
        formalOk={asis && !asis.sinDatos} formalNota={asis && !asis.sinDatos ? asis.nota : null}
        dim3Done={!!recom && justif.trim().length>=80}
      />

      {/* ═══ DIMENSIÓN 1 ═══ */}
      <SecTitle n='1' t={`Evaluación técnica de jefatura (${proc.pond_tecnica}%)`} extra={notaTec!=null?`Nota parcial: ${notaTec.toFixed(2)}`:null}/>
      {COMPETENCIAS.map(g => (
        <div key={g.g} style={{marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em',margin:'0 0 8px 2px'}}>{g.g}</div>
          <div style={{display:'grid',gap:8}}>
            {g.items.map(it => {
              const r = resp.items?.[it.k] || {}
              const exigeEv = requiereEvidencia(r.p, recom)
              return (
                <div key={it.k} style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:10,padding:'11px 14px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,marginBottom:8}}>
                    <div style={{fontSize:13,fontWeight:600}}>{it.l}</div>
                    <span title={`Pesa ${it.w}% dentro del bloque técnico · ${pesoFinalDe(it.w, proc.pond_tecnica)}% del puntaje final`}
                      style={{flexShrink:0,fontSize:10,fontWeight:800,color:'var(--text-muted)',background:'var(--bg-app)',border:'1px solid var(--border)',borderRadius:100,padding:'2px 9px'}}>
                      {it.w}% · {pesoFinalDe(it.w, proc.pond_tecnica)}% final
                    </span>
                  </div>
                  <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                    {ESCALA.map(e => (
                      <button key={e.v} onClick={()=>setItem(it.k,'p',e.v)}
                        title={e.v===1?it.a1:e.v===3?it.a3:e.v===5?it.a5:e.d}
                        style={{flex:'1 1 90px',padding:'7px 6px',borderRadius:8,cursor:'pointer',fontSize:11,
                          fontWeight: r.p===e.v ? 800 : 500,
                          background: r.p===e.v ? 'var(--accent)' : 'var(--bg-app)',
                          color: r.p===e.v ? 'white' : 'var(--text-muted)',
                          border:`1px solid ${r.p===e.v ? 'var(--accent)' : 'var(--border)'}`}}>
                        {e.v} · {e.l}
                      </button>
                    ))}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:7,fontSize:10,color:'var(--text-muted)'}}>
                    <span>1 = {it.a1}</span><span style={{textAlign:'center'}}>3 = {it.a3}</span><span style={{textAlign:'right'}}>5 = {it.a5}</span>
                  </div>
                  {exigeEv && (
                    <div style={{marginTop:8}}>
                      <label style={{...lblM,color:'#FF9500'}}>
                        Evidencia obligatoria del puntaje {r.p}{r.p === 2 ? ' (recomiendas no continuidad)' : ''} — hecho concreto, con fecha aproximada
                      </label>
                      <textarea {...ORTO} value={r.ev||''} onChange={e=>setItem(it.k,'ev',e.target.value)} rows={2}
                        placeholder='Ej: "En mayo detectó y corrigió un error de inventario que habría costado..."'
                        style={{...inpFull,resize:'vertical',fontFamily:'inherit'}}/>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Batería de control */}
      <div style={{background:'var(--bg-surface)',border:'1px dashed var(--border)',borderRadius:12,padding:'14px 16px',marginBottom:20}}>
        <div style={{fontSize:12.5,fontWeight:800,marginBottom:3}}>🧭 Control de objetividad</div>
        <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:12}}>
          Estas preguntas cruzan tus respuestas para detectar sesgos habituales (halo, severidad, recencia, afinidad).
          Las inconsistencias no anulan la evaluación: quedan como alertas visibles en el informe.
        </div>
        <div style={{display:'grid',gap:12}}>
          <div>
            <label style={lblM}>{CONTROL_TXT.c_errores}</label>
            <textarea {...ORTO} value={ctl.c_errores||''} onChange={e=>setCtl('c_errores',e.target.value)} rows={2} style={{...inpFull,resize:'vertical',fontFamily:'inherit'}}/>
          </div>
          <div>
            <label style={lblM}>{CONTROL_TXT.c_aportes}</label>
            <textarea {...ORTO} value={ctl.c_aportes||''} onChange={e=>setCtl('c_aportes',e.target.value)} rows={2} style={{...inpFull,resize:'vertical',fontFamily:'inherit'}}/>
          </div>
          <FilaEscala l={CONTROL_TXT.c_rehacer} opciones={FREC} val={ctl.c_rehacer} onSel={v=>setCtl('c_rehacer',v)}/>
          <FilaEscala l={CONTROL_TXT.c_conflictos} opciones={FREC} val={ctl.c_conflictos} onSel={v=>setCtl('c_conflictos',v)}/>
          <FilaEscala l={CONTROL_TXT.c_reemplazo} opciones={REEMPLAZO} val={ctl.c_reemplazo} onSel={v=>setCtl('c_reemplazo',v)}/>
          <FilaSiNo l={CONTROL_TXT.c_recontratar} val={ctl.c_recontratar} onSel={v=>setCtl('c_recontratar',v)}/>
          <FilaSiNo l={CONTROL_TXT.c_relacion} val={ctl.c_relacion} onSel={v=>setCtl('c_relacion',v)}/>
          {ctl.c_relacion === 'si' && (
            <input {...ORTO} value={ctl.c_relacion_det||''} onChange={e=>setCtl('c_relacion_det',e.target.value)}
              placeholder='Especifica la relación (ej: amistad fuera del trabajo, primo, conflicto en 2025...)' style={inpFull}/>
          )}
          <FilaSiNo l={CONTROL_TXT.c_periodo} val={ctl.c_periodo} onSel={v=>setCtl('c_periodo',v)}/>
        </div>
      </div>

      {/* ═══ DIMENSIÓN 2 ═══ */}
      <SecTitle n='2' t={`Aspectos formales — puntualidad y asistencia (${proc.pond_formal}%)`} extra={asis && !asis.sinDatos ? `Nota automática: ${asis.nota.toFixed(2)}` : null}/>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 16px',marginBottom:20}}>
        {!asis ? <div style={{fontSize:12.5,color:'var(--text-muted)'}}>Calculando desde Control de Asistencia...</div> :
        asis.sinDatos ? (
          <div style={{fontSize:12.5,color:'var(--text-muted)'}}>
            ⚠️ {asis.motivo === 'sin_registro_biometrico'
              ? `El trabajador no tiene registro biométrico en el período (${asis.sinRegistro?.dias || 0} jornadas antes de su enrolamiento en el reloj).`
              : 'Sin jornadas con turno en el período para este trabajador.'} Esta dimensión no se aplicará y las
            ponderaciones se redistribuirán proporcionalmente entre las otras dos.
          </div>
        ) : (
          <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginBottom:10}}>
              <Metrica l='Jornadas evaluables' v={asis.jornadas}/>
              <Metrica l='Puntualidad' v={asis.pctPuntualidad != null ? `${asis.pctPuntualidad}%` : 'No medible'}
                sub={asis.notaP != null ? `nota ${asis.notaP.toFixed(1)}` : 'sin marcas válidas'}
                c={asis.pctPuntualidad == null ? undefined : asis.pctPuntualidad>=85?'#34C759':asis.pctPuntualidad>=70?'#FF9500':'#FF3B30'}/>
              <Metrica l='Asistencia' v={`${asis.pctAsistencia}%`} sub={`nota ${asis.notaA.toFixed(1)}`} c={asis.pctAsistencia>=92?'#34C759':asis.pctAsistencia>=84?'#FF9500':'#FF3B30'}/>
              <Metrica l='Ausencias' v={asis.ausencias}/>
              <Metrica l='Min. atraso acum.' v={asis.minAtraso}/>
            </div>
            <ResumenCriterioD2 snap={asis}/>
            <div style={{fontSize:11,color:'var(--text-muted)',marginTop:10}}>
              Calculado automáticamente con la asistencia validada (marcas de Workera + validaciones de las jefaturas en el ERP) para el período del proceso.
              Ni el evaluador ni Gestión de Personas pueden modificar estos valores: se congelan al enviar.
              Nota formal = 60% puntualidad + 40% asistencia. Sólo descuentan las faltas injustificadas y los días sin justificar: licencias, vacaciones, permisos, feriados, días validados como trabajados y días previos al enrolamiento en el reloj no cuentan como ausencia.
            </div>
          </>
        )}
      </div>

      {/* ═══ DIMENSIÓN 3 ═══ */}
      <SecTitle n='3' t={`Recomendación de continuidad (${proc.pond_recom}%)`}/>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 16px',marginBottom:20}}>
        <div style={{display:'grid',gap:8,marginBottom:12}}>
          {RECOMS.map(r=>(
            <button key={r.k} onClick={()=>setRecom(r.k)}
              style={{display:'flex',alignItems:'center',gap:10,padding:'10px 13px',borderRadius:10,cursor:'pointer',textAlign:'left',
                background: recom===r.k ? `${r.c}14` : 'var(--bg-app)',
                border:`1.5px solid ${recom===r.k ? r.c : 'var(--border)'}`}}>
              <span style={{width:14,height:14,borderRadius:100,border:`2px solid ${r.c}`,background:recom===r.k?r.c:'transparent',flexShrink:0}}/>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:recom===r.k?r.c:'var(--text)'}}>{r.l}</div>
                <div style={{fontSize:11,color:'var(--text-muted)'}}>{r.d}</div>
              </div>
            </button>
          ))}
        </div>
        <label style={lblM}>Justificación de la recomendación (obligatoria — fundamenta con hechos del período)</label>
        <textarea {...ORTO} value={justif} onChange={e=>setJustif(e.target.value)} rows={3}
          placeholder='Mínimo 80 caracteres. Qué hechos concretos del período sustentan esta recomendación...'
          style={{...inpFull,resize:'vertical',fontFamily:'inherit'}}/>
        <div style={{fontSize:10.5,color:justif.trim().length>=80?'var(--success,#34C759)':'var(--text-muted)',marginTop:3}}>{justif.trim().length}/80 caracteres mínimos</div>

        {/* Antecedentes del período: contexto para fundamentar la recomendación */}
        <div style={{marginTop:12,paddingTop:10,borderTop:'1px dashed var(--border)'}}>
          <div style={{fontSize:11,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:6}}>
            Antecedentes del período registrados por Gestión de Personas ({ants ? ants.length : '…'})
          </div>
          {ants && ants.length > 0 ? (
            <div style={{display:'grid',gap:4}}>
              {ants.map(a => (
                <div key={a.id} style={{fontSize:12}}>
                  <span style={{color:'var(--text-muted)'}}>{fFecha(a.fecha)}</span> · <strong style={{color:COLOR_ANT[a.tipo]||'var(--text)'}}>{tipoAntL(a.tipo)}</strong> · {a.motivo}
                </div>
              ))}
            </div>
          ) : ants ? <div style={{fontSize:12,color:'var(--text-muted)'}}>Sin antecedentes registrados en el período.</div> : null}
          {recom === 'no_continuidad' && ants && ants.length === 0 && (
            <div style={{...avisoS,marginTop:8}}>
              Recomiendas no continuidad y no hay antecedentes documentados en el período (retroalimentaciones, amonestaciones o compromisos).
              Una decisión de no continuidad sin antecedentes es difícil de defender: coordina con Gestión de Personas antes de enviar.
            </div>
          )}
        </div>
      </div>

      {/* ═══ PLAN DE MEJORA ═══ */}
      {mostrarPlan ? (
        <EditorPlan plan={plan} onChange={setPlan} requerido={exigePlan} motivo={motivoPlan(catProy?.l, recom)}
          onQuitar={exigePlan ? null : () => { setPlan(PLAN_VACIO()); setVerPlan(false) }}/>
      ) : (
        <div style={{marginBottom:20}}>
          <button onClick={()=>setVerPlan(true)} style={{...btnGhost,fontSize:12}}>＋ Agregar plan de mejora (opcional)</button>
        </div>
      )}

      {/* Resultado en vivo + acciones */}
      <div style={{position:'sticky',bottom:0,background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',boxShadow:'0 -6px 20px rgba(0,0,0,0.08)'}}>
        <div style={{fontSize:12,color:'var(--text-muted)'}}>
          {notaFinal != null ? (
            <>Nota final proyectada: <strong style={{fontSize:17,color:catProy.c}}>{notaFinal.toFixed(2)}</strong>
            <span style={{marginLeft:8,fontWeight:700,color:catProy.c}}>{catProy.l}</span></>
          ) : 'Completa las 3 dimensiones para proyectar la nota final'}
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>setOrto({ modo:'manual' })} disabled={guardando||revisando} style={btnSec} title='Revisa la ortografía de todos los textos de la evaluación'>🔤 Ortografía</button>
          <button onClick={guardarBorrador} disabled={guardando||revisando} style={btnSec}>💾 Guardar borrador</button>
          <button onClick={()=>enviar()} disabled={guardando||revisando} style={btnPri}>{revisando ? 'Revisando ortografía...' : guardando ? 'Enviando...' : '✓ Enviar evaluación'}</button>
        </div>
      </div>
      {err && <div style={{fontSize:12.5,color:'#FF3B30',marginTop:10,padding:'9px 12px',background:'#FF3B3010',borderRadius:8}}>⚠️ {err}</div>}

      {orto && (
        <ModalOrtografia campos={camposTexto()} modo={orto.modo}
          onCerrar={()=>setOrto(null)}
          onContinuar={orto.modo === 'envio' ? () => enviar({ sinOrtografia:true }) : null}/>
      )}
    </div>
  )
}

// ─── Informe de evaluación ────────────────────────────────────────────────────
function InformeEvaluacion({ proc, evalRow: ev0, onVolver, autoPdf, cu, gestor, setMsg }) {
  const [ev, setEv] = useState(ev0)
  const [emp, setEmp] = useState(null)
  const [sucNombre, setSucNombre] = useState(null)
  const [evaluador, setEvaluador] = useState(null)   // { nombre, cargo } de quien firma como jefatura evaluadora
  const [firmaGP, setFirmaGP] = useState({ nombre:'', cargo:'Gestión de Personas' })
  const [ants, setAnts] = useState([])
  const [listo, setListo] = useState(false)
  const [pdfGenerado, setPdfGenerado] = useState(false)
  const [modal, setModal] = useState(null)           // 'devolver' | 'corregir' | 'recalcular'
  const [planEd, setPlanEd] = useState(null)
  const [retroEd, setRetroEd] = useState(null)
  const [guardando, setGuardando] = useState(false)

  // Informe automatizado: al llegar aquí tras "Enviar evaluación", genera y descarga
  // el PDF sin intervención del usuario (una sola vez, con los datos ya cargados).
  useEffect(() => {
    if (autoPdf && listo && !pdfGenerado && emp && ev?.nota_final != null) {
      setPdfGenerado(true)
      setTimeout(() => { try { exportPDF() } catch(e) { console.error('Auto-PDF:', e) } }, 400)
    }
  }, [autoPdf, listo, pdfGenerado, emp, ev])

  useEffect(() => { cargar() }, [ev0.id])
  async function cargar() {
    try {
      const [{ data: fresh }, { data: e }, { data: cfg }] = await Promise.all([
        supabase.from('eval_evaluaciones').select('*').eq('id', ev0.id).single(),
        supabase.from('rrhh_empleados').select('*').eq('cod_contaline', ev0.cod_contaline).single(),
        supabase.from('config_sistema').select('clave,valor').in('clave', ['rrhh_firma_gp_nombre','rrhh_firma_gp_cargo']),
      ])
      const evx = fresh || ev0
      // Firma como jefatura quien ENVIÓ la evaluación (antes se usaba quien creó el registro)
      const firmante = evx.enviada_por || evx.evaluador_id
      const [{ data: u }, { data: s }] = await Promise.all([
        supabase.from('usuarios').select('nombre,cargo,cod_contaline').eq('id', firmante).maybeSingle(),
        e?.sucursal_id ? supabase.from('sucursales').select('nombre').eq('id', e.sucursal_id).maybeSingle() : Promise.resolve({ data:null }),
      ])
      // Cargo de la jefatura: el definido en su usuario del ERP → ficha de RRHH → organigrama
      let cargo = u?.cargo || null
      if (!cargo && u?.cod_contaline != null) {
        const { data: re } = await supabase.from('rrhh_empleados').select('cargo').eq('cod_contaline', u.cod_contaline).maybeSingle()
        cargo = re?.cargo || null
        if (!cargo) {
          const { data: oa } = await supabase.from('org_asignaciones').select('cargo_id').eq('cod_contaline', u.cod_contaline).eq('activo', true).limit(1)
          if (oa?.[0]?.cargo_id != null) {
            const { data: oc } = await supabase.from('org_cargos').select('nombre').eq('id', oa[0].cargo_id).maybeSingle()
            cargo = oc?.nombre || null
          }
        }
      }
      const m = Object.fromEntries((cfg || []).map(r => [r.clave, r.valor]))
      await cargarAnts()
      setEv(evx); setEmp(e); setSucNombre(s?.nombre || null)
      setEvaluador(u ? { nombre: u.nombre, cargo: cargoProp(cargo || '') } : { nombre: firmante || '', cargo: '' })
      setFirmaGP({ nombre: m.rrhh_firma_gp_nombre || '', cargo: m.rrhh_firma_gp_cargo || 'Gestión de Personas' })
    } catch(e) { setMsg?.({ tipo:'error', txt:e.message }) }
    finally { setListo(true) }
  }
  async function cargarAnts() {
    const { data, error } = await supabase.from('rrhh_antecedentes').select('id,fecha,tipo,motivo,registrado_por,created_at')
      .eq('cod_contaline', ev0.cod_contaline).eq('activo', true)
      .gte('fecha', proc.periodo_desde).lte('fecha', proc.periodo_hasta).order('fecha')
    setAnts(error ? [] : (data || []))
  }

  const cat = ev.nota_final != null ? categoriaDe(Number(ev.nota_final)) : null
  const snap = ev.asis_snapshot || {}
  const v2 = (snap.version || 1) >= 2
  const alertas = ev.alertas || []
  const recomInfo = RECOMS.find(r=>r.k===ev.recomendacion)
  const ultRecalc = (ev.recalculos || []).slice(-1)[0] || null
  const antsAsc = useMemo(() => [...ants].sort((a,b) => String(a.fecha).localeCompare(String(b.fecha))), [ants])
  const enviada = ev.estado === 'enviada'
  const conRetro = !!ev.retro_fecha
  const esEvaluador = !!cu?.id && (cu.id === ev.enviada_por || cu.id === ev.evaluador_id)
  const puedeRetro = enviada && (gestor || (esEvaluador && !conRetro))
  const puedePlan = enviada && !conRetro && (gestor || esEvaluador)
  const exigePlan = planRequerido(ev.categoria, ev.recomendacion)
  const hayPlan = planTieneDatos(ev.plan_mejora)

  async function actualizar(cambios, okTxt) {
    setGuardando(true)
    try {
      const { data, error } = await supabase.from('eval_evaluaciones')
        .update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', ev.id).select().single()
      if (error) throw error
      setEv(data)
      if (okTxt) setMsg?.({ tipo:'ok', txt:okTxt })
      return true
    } catch(e) { setMsg?.({ tipo:'error', txt:e.message }); return false }
    finally { setGuardando(false) }
  }
  async function guardarPlan() {
    const e = validarPlan(planEd, hoyISO())
    if (e) { setMsg?.({ tipo:'error', txt:e }); return }
    if (await actualizar({ plan_mejora: planEd, plan_reevaluacion: planEd.reevaluacion || null }, 'Plan de mejora guardado')) setPlanEd(null)
  }
  async function guardarRetro() {
    const f = retroEd?.fecha
    if (!f) { setMsg?.({ tipo:'error', txt:'Indica la fecha de la retroalimentación.' }); return }
    if (f > hoyISO()) { setMsg?.({ tipo:'error', txt:'La fecha de la retroalimentación no puede ser futura.' }); return }
    const fEnvio = ev.enviada_at ? fechaCL(ev.enviada_at) : null
    if (fEnvio && f < fEnvio) { setMsg?.({ tipo:'error', txt:`La retroalimentación no puede ser anterior al envío de la evaluación (${fFecha(fEnvio)}).` }); return }
    if (exigePlan && !hayPlan) { setMsg?.({ tipo:'error', txt:'Registra primero el plan de mejora: la categoría lo exige y debe quedar en el documento que se firma.' }); return }
    if (await actualizar({
      retro_fecha: f, retro_comentarios: String(retroEd.comentarios || '').trim() || null,
      retro_registrada_por: cu?.id || null, retro_registrada_at: new Date().toISOString(),
    }, 'Retroalimentación registrada')) setRetroEd(null)
  }
  async function devolver(motivo) {
    const entrada = { at: new Date().toISOString(), por: cu?.id || null, por_nombre: cu?.nombre || null, motivo,
      enviada_at_previa: ev.enviada_at, nota_final_previa: ev.nota_final, categoria_previa: ev.categoria }
    const ok = await actualizar({ estado:'borrador', enviada_at:null, nota_final:null, categoria:null,
      devoluciones: [...(ev.devoluciones || []), entrada] }, 'Evaluación devuelta a la jefatura evaluadora')
    if (ok) { setModal(null); onVolver() }
  }
  async function guardarCorreccion(nuevos) {
    const r = JSON.parse(JSON.stringify(ev.respuestas || {}))
    let justificacion = ev.justificacion
    const cambios = []
    for (const [id, txt] of Object.entries(nuevos)) {
      let antes
      if (id === 'justif') { antes = ev.justificacion; justificacion = txt }
      else if (id.startsWith('ev_')) { const k = id.slice(3); antes = r.items?.[k]?.ev; if (r.items?.[k]) r.items[k].ev = txt }
      else { antes = r.control?.[id]; r.control = { ...(r.control || {}), [id]: txt } }
      if ((antes || '') !== (txt || '')) cambios.push({ campo:id, antes: antes || '', despues: txt || '' })
    }
    if (!cambios.length) { setModal(null); return }
    const ok = await actualizar({ respuestas: r, justificacion,
      correcciones: [...(ev.correcciones || []), { at: new Date().toISOString(), por: cu?.id || null, por_nombre: cu?.nombre || null, cambios }] },
      `Redacción corregida (${cambios.length} campo${cambios.length === 1 ? '' : 's'})`)
    if (ok) setModal(null)
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' })
    const azul = ROJO
    const W = 210, M = 14
    const nomTrab = nomProp(emp?.nombre || '')
    const fe = { nombre: nomProp(evaluador?.nombre || ''), cargo: evaluador?.cargo || '' }
    let cy = 26
    // Tabla con salto de página previo si no cabe ni el encabezado con un par de filas (evita encabezados huérfanos)
    const tabla = (opts, gap = 4) => {
      const { minimo = 22, ...resto } = opts
      if (cy + gap + minimo > 280) { doc.addPage(); cy = 25 - gap }
      doc.autoTable({ startY: cy + gap, margin:{ left:M, right:M, top:25, bottom:16 }, ...resto })
      cy = doc.lastAutoTable.finalY
    }
    const nota = (texto, size = 7.5, gris = 90) => {
      doc.setFontSize(size); doc.setTextColor(gris)
      const ls = doc.splitTextToSize(texto, W - 2*M), h = ls.length * size * 0.41
      if (cy + 3.5 + h > 280) { doc.addPage(); cy = 25 }
      doc.text(ls, M, cy + 3.5)
      cy = cy + 3.5 + h
      doc.setTextColor(0)
    }

    // ── Título (el encabezado con logo y el pie corporativo se dibujan al final, en todas las hojas)
    doc.setTextColor(...TINTA); doc.setFontSize(15); doc.setFont(undefined,'bold')
    doc.text('Informe de Evaluación de Desempeño', W/2, 30, { align:'center' })
    doc.setFontSize(9); doc.setFont(undefined,'normal'); doc.setTextColor(95)
    doc.text(`N° ${ev.id} · ${proc.nombre} · Período ${fFecha(proc.periodo_desde)} a ${fFecha(proc.periodo_hasta)}`, W/2, 35.5, { align:'center' })
    doc.setTextColor(0,0,0)
    cy = 37

    tabla({ theme:'plain', styles:{fontSize:9,cellPadding:1.2},
      columnStyles:{0:{fontStyle:'bold',cellWidth:34},2:{fontStyle:'bold',cellWidth:28}},
      body: [
        ['Trabajador', nomTrab || '—', 'RUT', emp?.rut || '—'],
        ['Cargo', cargoProp(emp?.cargo) || '—', 'Sucursal', sucNombre || emp?.sucursal_id || '—'],
        ['Jefatura evaluadora', fe.nombre || '—', 'Fecha de envío', ev.enviada_at ? fFecha(fechaCL(ev.enviada_at)) : '—'],
      ]}, 5)

    tabla({ theme:'grid', headStyles:{fillColor:azul,fontSize:9}, styles:{fontSize:9},
      head: [['Dimensión','Ponderación','Nota']],
      body: [
        ['1. Evaluación técnica de jefatura', `${proc.pond_tecnica}%`, ev.nota_tecnica!=null?Number(ev.nota_tecnica).toFixed(2):'—'],
        ['2. Aspectos formales (puntualidad y asistencia)', `${proc.pond_formal}%`, ev.nota_formal!=null?Number(ev.nota_formal).toFixed(2):'Sin datos — redistribuida'],
        ['3. Recomendación de continuidad', `${proc.pond_recom}%`, ev.nota_recom!=null?Number(ev.nota_recom).toFixed(2):'—'],
        [{content:'RESULTADO FINAL',styles:{fontStyle:'bold'}}, '', {content:`${Number(ev.nota_final).toFixed(2)} — ${ev.categoria}`,styles:{fontStyle:'bold'}}],
      ]})

    tabla({ theme:'grid', headStyles:{fillColor:azul,fontSize:8.5}, styles:{fontSize:7.8},
      columnStyles:{0:{cellWidth:62},1:{halign:'center',cellWidth:16},2:{halign:'center',cellWidth:16},3:{halign:'center',cellWidth:12}},
      head: [['Dimensión 1 — Competencia','Peso bloque','Peso final','Nota','Evidencia registrada']],
      body: [
        ...ITEMS.map(it => {
          const r = ev.respuestas?.items?.[it.k] || {}
          return [it.l, `${it.w}%`, `${pesoFinalDe(it.w, proc.pond_tecnica)}%`, r.p ?? '—', r.ev || '']
        }),
        [{content:'Nota técnica (promedio ponderado por peso)',styles:{fontStyle:'bold'}}, {content:'100%',styles:{fontStyle:'bold',halign:'center'}},
         {content:`${proc.pond_tecnica}%`,styles:{fontStyle:'bold',halign:'center'}},
         {content: ev.nota_tecnica!=null?Number(ev.nota_tecnica).toFixed(2):'—',styles:{fontStyle:'bold',halign:'center'}}, ''],
      ]})

    if (!snap.sinDatos && snap.jornadas != null) {
      tabla({ theme:'grid', headStyles:{fillColor:azul,fontSize:9}, styles:{fontSize:9},
        columnStyles:{1:{halign:'center',cellWidth:28},2:{halign:'center',cellWidth:18}},
        head: [['Dimensión 2 — Indicador (automático desde Control de Asistencia)','Valor','Nota']],
        body: [
          ['Jornadas evaluables del período', String(snap.jornadas), ''],
          ['Puntualidad', snap.pctPuntualidad != null ? `${snap.pctPuntualidad}%` : 'No medible', snap.notaP != null ? Number(snap.notaP).toFixed(1) : '—'],
          ['Asistencia', `${snap.pctAsistencia}%`, Number(snap.notaA).toFixed(1)],
          ['Ausencias (faltas injustificadas y días sin justificar)', String(snap.ausencias), ''],
          ['Minutos de atraso acumulados', String(snap.minAtraso), ''],
        ]})
      if (ultRecalc) nota(`Dimensión 2 recalculada el ${fFechaHora(ultRecalc.at)} con el criterio vigente (tolerancia del Reglamento Interno, errores de marcaje y días previos al enrolamiento biométrico). Valores anteriores: nota formal ${fmtN(ultRecalc.previo?.nota_formal)}, nota final ${fmtN(ultRecalc.previo?.nota_final)} (${ultRecalc.previo?.categoria || '—'}).`)
    }

    tabla({ theme:'grid', headStyles:{fillColor:azul,fontSize:9}, styles:{fontSize:9},
      head: [['Dimensión 3 — Recomendación de continuidad']],
      body: [[`${recomInfo?.l || '—'}`], [`Justificación: ${ev.justificacion || ''}`]] })

    tabla({ theme:'grid', headStyles:{fillColor: alertas.length ? NARANJO : azul, fontSize:9}, styles:{fontSize:8},
      head: [[`Alertas de objetividad (${alertas.length})`]],
      body: alertas.length ? alertas.map(a=>[`${a.t}: ${a.d}`]) : [['Sin alertas de sesgo detectadas. Controles de objetividad respondidos de forma consistente.']]})

    // ── Antecedentes del período (no afectan la nota)
    tabla({ theme:'grid', headStyles:{fillColor:azul,fontSize:8.5}, styles:{fontSize:8.5},
      columnStyles:{0:{cellWidth:22},1:{cellWidth:38}},
      head: [[{content:'Antecedentes del período (registro de Gestión de Personas; no afectan la nota)', colSpan:3}], ['Fecha','Tipo','Motivo']],
      body: antsAsc.length ? antsAsc.map(a => [fFecha(a.fecha), tipoAntL(a.tipo), a.motivo])
                           : [[{content:'Sin antecedentes registrados en el período.', colSpan:3}]] })

    // ── Plan de mejora (si la categoría o la recomendación lo exigen, o si se registró)
    if (exigePlan || hayPlan) {
      const comps = hayPlan
        ? ev.plan_mejora.compromisos.filter(c => Object.keys(PLAN_CAMPOS).some(k => String(c[k]||'').trim()) || c.plazo)
        : [{}, {}]
      tabla({ theme:'grid', headStyles:{fillColor:azul,fontSize:8.5}, styles:{fontSize:8.2,valign:'top'},
        bodyStyles:{ minCellHeight: hayPlan ? 0 : 16 },
        columnStyles:{0:{cellWidth:8,halign:'center'},4:{cellWidth:22,halign:'center'}},
        head: [[{content:'Plan de mejora', colSpan:5}], ['#','Conducta esperada','Apoyo de la jefatura','Cómo se medirá','Plazo']],
        body: comps.map((c,i) => [String(i+1), c.conducta || '', c.apoyo || '', c.medicion || '', c.plazo ? fFecha(c.plazo) : '']) })
      tabla({ theme:'grid', styles:{fontSize:9}, columnStyles:{0:{fontStyle:'bold',cellWidth:50}}, minimo: 8,
        body: [['Fecha de reevaluación', ev.plan_mejora?.reevaluacion ? fFecha(ev.plan_mejora.reevaluacion) : '_____ / _____ / __________']] }, 0)
    }

    // ── Retroalimentación (se completa en la reunión; si ya está registrada en el ERP, sale impresa)
    tabla({ theme:'grid', headStyles:{fillColor:azul,fontSize:9}, styles:{fontSize:9,valign:'top'},
      columnStyles:{0:{fontStyle:'bold',cellWidth:50}},
      head: [[{content:'Retroalimentación', colSpan:2}]],
      body: [
        ['Fecha de retroalimentación', ev.retro_fecha ? fFecha(ev.retro_fecha) : '_____ / _____ / __________'],
        ['Comentarios del trabajador', { content: ev.retro_comentarios || '', styles:{ minCellHeight: ev.retro_comentarios ? 8 : 28 } }],
      ]})

    // ── Firmas: jefatura (nombre y cargo) · trabajador (nombre, RUT y declaración) · Gestión de Personas
    if (cy + 8 + 52 > 280) { doc.addPage(); cy = 25 }
    const y0 = cy + 8
    const colW = (W - 2*M - 16) / 3
    const xs = [M, M + colW + 8, M + 2*(colW + 8)]
    doc.setFontSize(8); doc.setFont(undefined,'italic')
    doc.text(doc.splitTextToSize(DECLARACION_TRAB, colW - 2), xs[1] + colW/2, y0 + 3, { align:'center' })
    doc.setFont(undefined,'normal')
    const yL = y0 + 24
    const firmas = [
      { titulo:'Jefatura evaluadora', nombre: fe.nombre, sub: fe.cargo || 'Cargo: ____________________' },
      { titulo:'Trabajador evaluado', nombre: nomTrab, sub: emp?.rut ? `RUT ${emp.rut}` : 'RUT ______________' },
      { titulo:'Gestión de Personas', nombre: nomProp(firmaGP.nombre), sub: firmaGP.cargo },
    ]
    let yMax = yL
    firmas.forEach((f, i) => {
      const cx = xs[i] + colW/2
      doc.setDrawColor(70); doc.setLineWidth(0.3); doc.line(xs[i] + 2, yL, xs[i] + colW - 2, yL)
      doc.setFontSize(8.5); doc.setFont(undefined,'bold')
      const ln = doc.splitTextToSize(f.nombre || ' ', colW - 2)
      doc.text(ln, cx, yL + 4.5, { align:'center' })
      doc.setFont(undefined,'normal'); doc.setFontSize(8)
      const ys = yL + 4.5 + ln.length * 3.6
      const ls = doc.splitTextToSize(f.sub || ' ', colW - 2)
      doc.text(ls, cx, ys, { align:'center' })
      doc.setFontSize(7); doc.setTextColor(120)
      const yt = ys + ls.length * 3.4 + 0.6
      doc.text(f.titulo.toUpperCase(), cx, yt, { align:'center' })
      doc.setTextColor(0)
      yMax = Math.max(yMax, yt)
    })
    cy = yMax + 2
    nota('La firma del trabajador acredita que recibió la retroalimentación; no implica necesariamente conformidad con su contenido. Sus observaciones pueden quedar registradas en «Comentarios del trabajador».', 7, 110)

    // ═══ ANEXO — Registro de asistencia y puntualidad (Dimensión 2) ═══
    // Explica el "porqué" de los porcentajes y la nota formal, con el detalle
    // día a día de incidencias congelado en asis_snapshot al momento de enviar.
    if (!snap.sinDatos && snap.jornadas != null) {
      doc.addPage()
      doc.setTextColor(...ROJO); doc.setFontSize(12.5); doc.setFont(undefined,'bold')
      doc.text('Anexo — Registro de asistencia y puntualidad', M, 30)
      doc.setTextColor(95); doc.setFontSize(8.5); doc.setFont(undefined,'normal')
      doc.text(`Respaldo de la Dimensión 2 (${proc.pond_formal}%) · ${nomTrab} · Período ${fFecha(proc.periodo_desde)} a ${fFecha(proc.periodo_hasta)}`, M, 35)
      doc.setTextColor(0,0,0)

      const tol = snap.parametros?.toleranciaMin ?? 5, atip = snap.parametros?.atipicoMin ?? 120, tope = snap.parametros?.topeMensualMin ?? 60
      const metod = v2
        ? 'Metodología: los indicadores se calculan con la asistencia validada (marcas de Workera y validaciones de las jefaturas en el ERP, ' +
          'mismo criterio que la pre-nómina) sobre las jornadas con turno del período. No cuentan como ausencia las licencias, vacaciones, permisos, ' +
          'feriados, los días validados como trabajados ni los días previos al enrolamiento del trabajador en el reloj biométrico. ' +
          `Puntualidad = días trabajados con marca de entrada a la hora ÷ días trabajados con marca válida. Los atrasos de hasta ${tol} minutos ` +
          `están dentro de la tolerancia del art. 27 del Reglamento Interno y no se consideran atraso, salvo el exceso cuando en el mes suman más de ${tope} minutos; tampoco cuentan los cubiertos por un permiso. ` +
          'Los errores de marcaje (sin marca de entrada, marca única cercana a la hora de salida o día de enrolamiento) no se consideran en la puntualidad. ' +
          `Los atrasos de más de ${atip} minutos con entrada y salida marcadas sí se cuentan y quedan señalados para verificar el turno asignado. ` +
          'Asistencia = (jornadas evaluables - faltas injustificadas y días sin justificar) ÷ jornadas evaluables. Cada porcentaje se convierte a ' +
          'nota 1–5 según los tramos de la tabla siguiente. Nota formal = 60% nota puntualidad + 40% nota asistencia.'
        : snap.fuente === 'asistencia_validada'
          ? 'Metodología: los indicadores se calculan con la asistencia validada (marcas de Workera y validaciones de las jefaturas en el ERP, ' +
            'mismo criterio que la pre-nómina) sobre las jornadas con turno del período, sin contar licencias, vacaciones, permisos, feriados ni días ' +
            'validados como trabajados. Puntualidad = días trabajados con marca de entrada a la hora (o atraso cubierto por un permiso) ÷ días trabajados ' +
            'con marcas. Asistencia = (jornadas evaluables - faltas injustificadas y días sin justificar) ÷ jornadas evaluables. Cada porcentaje se ' +
            'convierte a nota 1–5 según los tramos de la tabla siguiente. Nota formal = 60% nota puntualidad + 40% nota asistencia.'
          : 'Metodología: los indicadores se calculan automáticamente desde el Control de Asistencia (Workera) sobre las jornadas ' +
            'con turno asignado del período. Puntualidad = jornadas puntuales (incluye días con horas extra) ÷ jornadas con turno. ' +
            'Asistencia = (jornadas con turno - ausencias sin marcas) ÷ jornadas con turno. Cada porcentaje se convierte a nota 1–5 ' +
            'según los tramos de la tabla siguiente. Nota formal = 60% nota puntualidad + 40% nota asistencia.'
      doc.setFontSize(8.3)
      const lm = doc.splitTextToSize(metod + ' Estos valores se congelan al enviar la evaluación y no son editables por el evaluador ni por Gestión de Personas.', W - 2*M)
      doc.text(lm, M, 41)
      cy = 41 + lm.length * 3.45

      const punt = snap.puntuales != null ? snap.puntuales : Math.round((snap.pctPuntualidad||0) * snap.jornadas / 100)
      const pctNota = (pct, n) => pct != null && n != null ? `${pct}% = nota ${Number(n).toFixed(1)}` : 'No medible'
      tabla({ theme:'grid', headStyles:{fillColor:NARANJO,fontSize:8.5}, styles:{fontSize:8.2},
        columnStyles:{0:{cellWidth:50},2:{cellWidth:34,halign:'center'}},
        head: [['Cálculo del porcentaje y la nota','Detalle','Resultado']],
        body: [
          ['Jornadas evaluables', v2 ? 'Con turno; sin licencias, vacaciones, permisos, feriados ni días previos al enrolamiento' : snap.fuente === 'asistencia_validada' ? 'Base del cálculo (sin licencias, vacaciones, permisos ni feriados)' : 'Base del cálculo', String(snap.jornadas)],
          ['Puntualidad', snap.fuente === 'asistencia_validada' ? `${punt} de ${snap.diasTrabajadosConMarca ?? snap.jornadas} días trabajados con marca válida, a la hora` : `${punt} de ${snap.jornadas} jornadas puntuales`, pctNota(snap.pctPuntualidad, snap.notaP)],
          ['Asistencia', snap.fuente === 'asistencia_validada' ? `${snap.ausencias} falta(s) injustificada(s) o día(s) sin justificar de ${snap.jornadas} jornadas` : `${snap.ausencias} ausencia(s) sin marcas de ${snap.jornadas} jornadas`, pctNota(snap.pctAsistencia, snap.notaA)],
          ['Minutos de atraso acumulados', v2 ? 'Suma de los atrasos fuera de la tolerancia' : 'Suma de atrasos contables del período', String(snap.minAtraso)],
          ...(v2 ? [
            ['Atrasos dentro de la tolerancia', `Hasta ${tol} min (art. 27 del Reglamento Interno): no se consideran atraso`, String(snap.enTolerancia ?? 0)],
            ...(snap.parametros?.topeMensualMin != null ? [['Exceso sobre el tope mensual', `Atrasos tolerados que en el mes superan ${tope} min (art. 27): sí cuentan`, `${snap.excesoTolerancia ?? 0} min`]] : []),
            ['Errores de marcaje excluidos', 'Sin marca de entrada, marca única cercana a la salida o día de enrolamiento', String(snap.atipicos ?? 0)],
            ['Atrasos extremos por verificar', `Más de ${atip} min con entrada y salida marcadas: verificar el turno asignado`, String(snap.atrasosExtremos ?? 0)],
            ['Días sin registro biométrico', snap.sinRegistro ? `${fFecha(snap.sinRegistro.desde)} a ${fFecha(snap.sinRegistro.hasta)} (primera marca: ${fFecha(snap.sinRegistro.primeraMarca)}); no cuentan como ausencia` : 'No hubo', String(snap.sinRegistro?.dias ?? 0)],
          ] : []),
          [{content:'Nota formal (Dimensión 2)',styles:{fontStyle:'bold'}},
           snap.notaP != null ? `= 60% × ${Number(snap.notaP).toFixed(1)} + 40% × ${Number(snap.notaA).toFixed(1)}` : `= nota de asistencia (puntualidad no medible)`,
           {content: ev.nota_formal!=null?Number(ev.nota_formal).toFixed(2):'—', styles:{fontStyle:'bold'}}],
        ]})

      const tramosP = [['95% o más','5.0'],['90% a 94%','4.5'],['85% a 89%','4.0'],['78% a 84%','3.5'],['70% a 77%','3.0'],['60% a 69%','2.0'],['Menos de 60%','1.0']]
      const tramosA = [['98% o más','5.0'],['95% a 97%','4.5'],['92% a 94%','4.0'],['88% a 91%','3.5'],['84% a 87%','3.0'],['75% a 83%','2.0'],['Menos de 75%','1.0']]
      const marcaP = snap.notaP != null ? Number(snap.notaP).toFixed(1) : null, marcaA = Number(snap.notaA).toFixed(1)
      const marcar = (t, m) => t[1] === m ? t.map(c => ({ content:c, styles:{ fontStyle:'bold', fillColor:[232,240,254] } })) : t
      if (cy + 62 > 280) { doc.addPage(); cy = 21 }
      const yT = cy + 4
      doc.autoTable({ startY: yT, theme:'grid', margin:{ left:M, right:112, top:25, bottom:16 },
        headStyles:{fillColor:NARANJO,fontSize:8}, styles:{fontSize:8},
        head: [['Tramo puntualidad','Nota']], body: tramosP.map(t => marcar(t, marcaP)) })
      const yF1 = doc.lastAutoTable.finalY
      doc.autoTable({ startY: yT, theme:'grid', margin:{ left:112, right:M, top:25, bottom:16 },
        headStyles:{fillColor:NARANJO,fontSize:8}, styles:{fontSize:8},
        head: [['Tramo asistencia','Nota']], body: tramosA.map(t => marcar(t, marcaA)) })
      cy = Math.max(yF1, doc.lastAutoTable.finalY)

      const incs = snap.incidencias || []
      tabla({ theme:'grid', headStyles:{fillColor:NARANJO,fontSize:8.5}, styles:{fontSize:7.8},
        columnStyles:{0:{cellWidth:22},1:{cellWidth:40},3:{cellWidth:14,halign:'center'}},
        head: [['Fecha','Tipo','Detalle','Min.']],
        body: incs.length
          ? incs.map(i => [fFecha(i.fecha), i.tipo, i.det || '', i.min ? String(i.min) : '—'])
          : [[{content: snap.incidencias ? 'Sin atrasos ni ausencias registradas en el período: cumplió el 100% de las jornadas evaluables sin incidencias.' : 'Detalle día a día no disponible (evaluación enviada con una versión anterior del módulo). Los totales de la tabla superior provienen del registro congelado al enviar.', colSpan:4}]] })
      nota('Las ausencias listadas no descuentan permisos autorizados: si existe un permiso o licencia que justifique una ausencia, debe registrarse en Control de Asistencia antes de la retroalimentación. Si un atraso extremo corresponde a un turno mal asignado, Gestión de Personas debe corregir el turno y recalcular la Dimensión 2.', 7, 110)
    }

    // ── Encabezado y pie corporativos en todas las hojas (identifican el documento firmado)
    // El logo del ERP es un cuadrado con margen blanco: se ubica para que la parte visible
    // quede en 14-35 mm x 5-15,5 mm sin tapar el contenido (que parte en 25 mm).
    const n = doc.getNumberOfPages()
    for (let i = 1; i <= n; i++) {
      doc.setPage(i)
      try { doc.addImage(LOGO_B64, 'JPEG', M - 1.4, -1.5, 24.1, 24.1) } catch (e) { /* sin logo */ }
      doc.setFontSize(8); doc.setTextColor(110)
      doc.text('Gestión de Personas · Uso interno', W - M, 11.5, { align:'right' })
      doc.text(`Evaluación N° ${ev.id}`, W - M, 15.5, { align:'right' })
      doc.setDrawColor(...NARANJO); doc.setLineWidth(0.6); doc.line(M, 20, W - M, 20)
      doc.setFontSize(7); doc.setTextColor(120)
      doc.text(`Outlet de Puertas SpA · ${nomTrab} · ${proc.nombre} · Documento generado por el ERP`, M, 288.5)
      doc.text(`Página ${i} de ${n}`, W - M, 288.5, { align:'right' })
      doc.setFillColor(...ROJO); doc.rect(0, 292.5, W, 4.5, 'F')
      doc.setTextColor(0); doc.setDrawColor(0); doc.setLineWidth(0.2)
    }

    doc.save(`Evaluacion_${(nomTrab || 'trabajador').replace(/\s+/g,'_')}_${proc.periodo_hasta}.pdf`)
  }

  return (
    <div style={{maxWidth:860,margin:'0 auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,flexWrap:'wrap',marginBottom:14}}>
        <button onClick={onVolver} style={btnSec}>&larr; Volver</button>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'flex-end'}}>
          {gestor && enviada && !conRetro && (
            <button onClick={()=>setModal('recalcular')} style={btnSec} title='Recalcula la Dimensión 2 con el criterio y la asistencia vigentes (mismo período de la evaluación)'>↻ Recalcular D2</button>
          )}
          {gestor && enviada && (
            <button onClick={()=>setModal('corregir')} style={btnSec} title='Corregir ortografía y redacción de los textos (queda registro de cada cambio)'>✏️ Corregir redacción</button>
          )}
          {gestor && enviada && (
            <button onClick={()=>{ if (!conRetro) setModal('devolver') }} disabled={conRetro}
              title={conRetro ? 'Ya tiene retroalimentación registrada: el documento ya se firmó' : 'Devuelve la evaluación a la jefatura para corregirla y reenviarla'}
              style={{...btnSec,opacity:conRetro?0.45:1,cursor:conRetro?'not-allowed':'pointer'}}>↩︎ Devolver</button>
          )}
          <button onClick={exportPDF} disabled={!listo || !enviada} style={{...btnPri,opacity:(listo && enviada)?1:0.5}}>⬇️ Exportar informe PDF</button>
        </div>
      </div>

      {/* Resultado */}
      <div style={{background:`linear-gradient(135deg, ${cat?.c||'#888'}12, transparent 55%)`,border:'1px solid var(--border)',borderRadius:14,padding:'18px 20px',marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:12,alignItems:'center'}}>
          <div>
            <div style={{fontSize:17,fontWeight:800}}>
              {emp ? nomProp(emp.nombre) : '...'}
              {emp && emp.activo === false && <span style={badgeEgr}>EGRESADO{emp.fecha_egreso ? ` ${fFecha(emp.fecha_egreso)}` : ''}</span>}
              {!enviada && <span style={{...badgeEgr,background:'#FF950018',color:'#FF9500'}}>BORRADOR</span>}
            </div>
            <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>
              {cargoProp(emp?.cargo)||'—'} · {sucNombre || emp?.sucursal_id || '—'} · RUT {emp?.rut || '—'} ·
              Jefatura evaluadora: {evaluador?.nombre ? nomProp(evaluador.nombre) : '—'}{evaluador?.cargo ? ` (${evaluador.cargo})` : ''} ·
              Enviada: {ev.enviada_at ? fFecha(fechaCL(ev.enviada_at)) : '—'}
            </div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontSize:34,fontWeight:900,color:cat?.c,lineHeight:1}}>{ev.nota_final!=null?Number(ev.nota_final).toFixed(2):'—'}</div>
            <div style={{fontSize:12,fontWeight:800,color:cat?.c}}>{ev.categoria}</div>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginTop:14}}>
          <BarraDim l={`Técnica (${proc.pond_tecnica}%)`} n={ev.nota_tecnica}/>
          <BarraDim l={`Formal (${proc.pond_formal}%)`} n={ev.nota_formal} vacio={snap.sinDatos ? 'Sin datos' : null}/>
          <BarraDim l={`Recomendación (${proc.pond_recom}%)`} n={ev.nota_recom}/>
        </div>
      </div>

      {/* Perfil por competencia (radar) */}
      <div style={{marginBottom:16}}>
        <div style={secTituloI}>Perfil por competencia — Dimensión 1</div>
        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 16px',display:'flex',gap:24,flexWrap:'wrap',alignItems:'center'}}>
          <RadarSVG datos={perfilCompetencias(ev.respuestas)} size={210}/>
          <div style={{flex:1,minWidth:220,display:'grid',gap:9}}>
            {perfilCompetencias(ev.respuestas).map(g=>(
              <div key={g.l}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11.5,marginBottom:3}}>
                  <span style={{fontWeight:600}}>{g.l}</span>
                  <span style={{fontWeight:800,color:categoriaDe(g.v).c}}>{g.v.toFixed(2)}</span>
                </div>
                <div style={{height:7,background:'var(--bg-app)',borderRadius:100,overflow:'hidden'}}>
                  <div style={{width:`${g.v/5*100}%`,height:'100%',borderRadius:100,background:categoriaDe(g.v).c,transition:'width .4s ease'}}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Alertas */}
      <div style={{marginBottom:16}}>
        <div style={secTituloI}>🧭 Alertas de objetividad ({alertas.length})</div>
        {alertas.length === 0 ? (
          <div style={{fontSize:12.5,color:'var(--success,#34C759)',background:'#34C75910',border:'1px solid #34C75930',borderRadius:10,padding:'10px 13px'}}>
            ✓ Sin alertas de sesgo: los controles de objetividad se respondieron de forma consistente.
          </div>
        ) : (
          <div style={{display:'grid',gap:6}}>
            {alertas.map((a,i)=>(
              <div key={i} style={{fontSize:12,background:'#FF950010',border:'1px solid #FF950035',borderLeft:'3px solid #FF9500',borderRadius:8,padding:'8px 12px'}}>
                <strong>{a.t}.</strong> {a.d}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dimensión 1 detalle */}
      <div style={secTituloI}>Dimensión 1 — Evaluación técnica</div>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden',marginBottom:16}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <tbody>
            {ITEMS.map(it => {
              const r = ev.respuestas?.items?.[it.k] || {}
              return (
                <tr key={it.k} style={{borderBottom:'1px solid var(--border)'}}>
                  <td style={{...tdS,width:'55%'}}>{it.l}{r.ev && <div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:2}}>Evidencia: {r.ev}</div>}</td>
                  <td style={{...tdS,textAlign:'right',whiteSpace:'nowrap',color:'var(--text-muted)',fontSize:11}}>{it.w}% · {pesoFinalDe(it.w, proc.pond_tecnica)}% final</td>
                  <td style={{...tdS,textAlign:'right'}}>
                    <span style={{fontWeight:800,fontSize:13}}>{r.p ?? '—'}</span>
                    <span style={{fontSize:10.5,color:'var(--text-muted)',marginLeft:5}}>{ESCALA.find(e=>e.v===r.p)?.l||''}</span>
                  </td>
                </tr>
              )
            })}
            <tr style={{borderTop:'2px solid var(--border)',background:'var(--bg-app)'}}>
              <td style={{...tdS,fontWeight:800}}>Nota técnica (promedio ponderado por peso)</td>
              <td style={{...tdS,textAlign:'right',fontWeight:800,color:'var(--text-muted)',fontSize:11}}>100% · {proc.pond_tecnica}% final</td>
              <td style={{...tdS,textAlign:'right',fontWeight:900,fontSize:14}}>{ev.nota_tecnica!=null?Number(ev.nota_tecnica).toFixed(2):'—'}</td>
            </tr>
          </tbody>
        </table>
        <div style={{padding:'10px 14px',fontSize:11.5,color:'var(--text-muted)',borderTop:'1px solid var(--border)'}}>
          <strong>Errores del período declarados:</strong> {ev.respuestas?.control?.c_errores || '—'}<br/>
          <strong>Aportes del período declarados:</strong> {ev.respuestas?.control?.c_aportes || '—'}
        </div>
      </div>

      {/* Dimensión 2 detalle */}
      <div style={secTituloI}>Dimensión 2 — Aspectos formales (automático)</div>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'13px 16px',marginBottom:16}}>
        {snap.sinDatos ? (
          <div style={{fontSize:12.5,color:'var(--text-muted)'}}>
            {snap.motivo === 'sin_registro_biometrico'
              ? `Sin registro biométrico en el período (${snap.sinRegistro?.dias || 0} jornadas previas al enrolamiento en el reloj)`
              : 'Sin jornadas con turno en el período'} — dimensión redistribuida entre las otras dos.
          </div>
        ) : (
          <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10}}>
              <Metrica l='Jornadas' v={snap.jornadas}/>
              <Metrica l='Puntualidad' v={snap.pctPuntualidad != null ? `${snap.pctPuntualidad}%` : 'No medible'} sub={snap.notaP != null ? `nota ${Number(snap.notaP).toFixed(1)}` : null}/>
              <Metrica l='Asistencia' v={`${snap.pctAsistencia}%`} sub={`nota ${Number(snap.notaA).toFixed(1)}`}/>
              <Metrica l='Ausencias' v={snap.ausencias}/>
              <Metrica l='Min. atraso' v={snap.minAtraso}/>
            </div>
            {v2 && <ResumenCriterioD2 snap={snap}/>}
            <div style={{fontSize:11.5,color:'var(--text-muted)',marginTop:10,padding:'8px 11px',background:'var(--bg-app)',borderRadius:8}}>
              <strong>Porqué de la nota:</strong> puntualidad {snap.pctPuntualidad != null ? `${snap.pctPuntualidad}% → nota ${Number(snap.notaP).toFixed(1)}` : 'no medible'} ·
              asistencia {snap.pctAsistencia}% → nota {Number(snap.notaA).toFixed(1)} ·
              Nota formal = {snap.notaP != null ? `60% × ${Number(snap.notaP).toFixed(1)} + 40% × ${Number(snap.notaA).toFixed(1)}` : 'nota de asistencia'} = <strong>{ev.nota_formal!=null?Number(ev.nota_formal).toFixed(2):'—'}</strong>.
              El detalle completo (tramos e incidencias día a día) va como anexo en el PDF.
            </div>
            {ultRecalc && (
              <div style={{fontSize:11.5,marginTop:8,color:'var(--text-muted)'}}>
                ↻ Recalculada el {fFechaHora(ultRecalc.at)}: nota formal {fmtN(ultRecalc.previo?.nota_formal)} → {fmtN(ultRecalc.nuevo?.nota_formal)} ·
                nota final {fmtN(ultRecalc.previo?.nota_final)} → {fmtN(ultRecalc.nuevo?.nota_final)}. {ultRecalc.motivo}
              </div>
            )}
            {(snap.incidencias?.length > 0) && (
              <div style={{marginTop:10}}>
                <div style={{fontSize:11,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:6}}>
                  Incidencias del período ({snap.incidencias.length})
                </div>
                <div style={{maxHeight:320,overflowY:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:11.5}}>
                    <tbody>
                      {snap.incidencias.map((inc,i)=>(
                        <tr key={i} style={{borderTop:'1px solid var(--border)'}}>
                          <td style={{padding:'5px 8px',width:96,whiteSpace:'nowrap'}}>{fFecha(inc.fecha)}</td>
                          <td style={{padding:'5px 8px',fontWeight:600,whiteSpace:'nowrap',color: inc.tipo==='Atraso' ? '#FF9500' : inc.tipo==='Marcaje atípico' ? '#8E8E93' : '#FF3B30'}}>{inc.tipo}</td>
                          <td style={{padding:'5px 8px',color:'var(--text-muted)'}}>{inc.det || ''}</td>
                          <td style={{padding:'5px 8px',textAlign:'right',color:'var(--text-muted)',whiteSpace:'nowrap'}}>{inc.min ? `${inc.min} min` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Dimensión 3 detalle */}
      <div style={secTituloI}>Dimensión 3 — Recomendación de continuidad</div>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'13px 16px',marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:800,color:recomInfo?.c,marginBottom:6}}>{recomInfo?.l || '—'}</div>
        <div style={{fontSize:12.5,whiteSpace:'pre-wrap'}}>{ev.justificacion || '—'}</div>
      </div>

      {/* Antecedentes del período */}
      <div style={secTituloI}>Antecedentes del período ({ants.length})</div>
      <PanelAntecedentes cod={ev.cod_contaline} items={antsAsc} editable={!!gestor} cu={cu} setMsg={setMsg} onCambio={cargarAnts}
        desde={proc.periodo_desde} hasta={proc.periodo_hasta}
        nota='Registro de Gestión de Personas: retroalimentaciones, amonestaciones y compromisos previos. No afecta la nota; respalda la recomendación de continuidad y se imprime en el informe.'/>
      {ev.recomendacion === 'no_continuidad' && ants.length === 0 && (
        <div style={{...avisoS,marginTop:-8,marginBottom:16}}>
          Recomendación de no continuidad sin antecedentes documentados en el período. Una decisión de no continuidad sin antecedentes es difícil de defender:
          si existen retroalimentaciones, amonestaciones o compromisos previos, regístralos antes de la retroalimentación. (Este aviso no se imprime.)
        </div>
      )}

      {/* Plan de mejora */}
      <div style={secTituloI}>Plan de mejora</div>
      {planEd ? (
        <>
          <EditorPlan plan={planEd} onChange={setPlanEd} requerido={exigePlan} motivo={motivoPlan(ev.categoria, ev.recomendacion)}/>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:-10,marginBottom:16}}>
            <button onClick={()=>setPlanEd(null)} disabled={guardando} style={btnSec}>Cancelar</button>
            <button onClick={guardarPlan} disabled={guardando} style={btnPri}>{guardando ? 'Guardando...' : 'Guardar plan'}</button>
          </div>
        </>
      ) : hayPlan ? (
        <div style={cardS}>
          <PlanLectura plan={ev.plan_mejora}/>
          {puedePlan && <button onClick={()=>setPlanEd(ev.plan_mejora)} style={{...btnSec,marginTop:10,padding:'6px 12px',fontSize:12}}>Editar plan</button>}
        </div>
      ) : exigePlan ? (
        <div style={{...avisoS,marginBottom:16}}>
          <strong>Plan de mejora pendiente.</strong> {motivoPlan(ev.categoria, ev.recomendacion)}
          {enviada && (puedePlan
            ? <div style={{marginTop:8}}><button onClick={()=>setPlanEd(PLAN_VACIO())} style={{...btnPri,padding:'6px 12px',fontSize:12}}>Registrar plan de mejora</button></div>
            : <div style={{marginTop:4,color:'var(--text-muted)'}}>Lo registra la jefatura evaluadora o Gestión de Personas antes de la retroalimentación.</div>)}
        </div>
      ) : (
        <div style={{...cardS,fontSize:12.5,color:'var(--text-muted)'}}>
          No aplica para este resultado.
          {puedePlan && <button onClick={()=>setPlanEd(PLAN_VACIO())} style={{...btnGhost,marginLeft:10,padding:'4px 10px',fontSize:12}}>＋ Agregar plan (opcional)</button>}
        </div>
      )}

      {/* Retroalimentación */}
      <div style={secTituloI}>Retroalimentación</div>
      <div style={cardS}>
        {retroEd ? (
          <div style={{display:'grid',gap:10}}>
            <div style={{maxWidth:220}}>
              <label style={lblM}>Fecha de retroalimentación</label>
              <input type='date' value={retroEd.fecha || ''} max={hoyISO()} onChange={e=>setRetroEd(r=>({...r, fecha:e.target.value}))} style={inpFull}/>
            </div>
            <div>
              <label style={lblM}>Comentarios del trabajador (opcional — también puede escribirlos a mano en el documento)</label>
              <textarea {...ORTO} rows={3} value={retroEd.comentarios || ''} onChange={e=>setRetroEd(r=>({...r, comentarios:e.target.value}))}
                style={{...inpFull,resize:'vertical',fontFamily:'inherit'}}/>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setRetroEd(null)} disabled={guardando} style={btnSec}>Cancelar</button>
              <button onClick={guardarRetro} disabled={guardando} style={btnPri}>{guardando ? 'Guardando...' : 'Registrar retroalimentación'}</button>
            </div>
          </div>
        ) : conRetro ? (
          <div style={{fontSize:12.5}}>
            <div>✓ Realizada el <strong>{fFecha(ev.retro_fecha)}</strong>{ev.retro_registrada_at ? <span style={{color:'var(--text-muted)'}}> · registrada el {fFechaHora(ev.retro_registrada_at)}</span> : null}</div>
            <div style={{marginTop:6,whiteSpace:'pre-wrap'}}><strong>Comentarios del trabajador:</strong> {ev.retro_comentarios || <span style={{color:'var(--text-muted)'}}>sin comentarios registrados en el ERP</span>}</div>
            {puedeRetro && <button onClick={()=>setRetroEd({ fecha: ev.retro_fecha, comentarios: ev.retro_comentarios || '' })} style={{...btnSec,marginTop:10,padding:'6px 12px',fontSize:12}}>Editar</button>}
          </div>
        ) : (
          <div style={{fontSize:12.5,color:'var(--text-muted)'}}>
            Pendiente. Imprime el informe, realiza la retroalimentación con el trabajador y registra aquí la fecha y sus comentarios.
            Mientras no se registre, el PDF sale con los campos en blanco para completarlos a mano.
            {puedeRetro && <div style={{marginTop:8}}><button onClick={()=>setRetroEd({ fecha: hoyISO(), comentarios:'' })} style={{...btnPri,padding:'6px 12px',fontSize:12}}>Registrar retroalimentación</button></div>}
          </div>
        )}
      </div>

      {/* Historial de cambios posteriores al envío */}
      {((ev.devoluciones||[]).length + (ev.correcciones||[]).length + (ev.recalculos||[]).length) > 0 && (
        <>
          <div style={secTituloI}>Historial de cambios</div>
          <div style={{...cardS,display:'grid',gap:5,fontSize:12}}>
            {(ev.devoluciones||[]).map((d,i)=>(<div key={`d${i}`}>↩︎ {fFechaHora(d.at)} · Devuelta a la jefatura{d.por_nombre ? ` por ${d.por_nombre}` : ''}: {d.motivo}</div>))}
            {(ev.correcciones||[]).map((c,i)=>(<div key={`c${i}`}>✏️ {fFechaHora(c.at)} · Redacción corregida{c.por_nombre ? ` por ${c.por_nombre}` : ''} ({(c.cambios||[]).length} campo{(c.cambios||[]).length===1?'':'s'})</div>))}
            {(ev.recalculos||[]).map((r,i)=>(<div key={`r${i}`}>↻ {fFechaHora(r.at)} · Dimensión 2 recalculada: nota final {fmtN(r.previo?.nota_final)} → {fmtN(r.nuevo?.nota_final)} ({r.nuevo?.categoria || '—'})</div>))}
          </div>
        </>
      )}

      {modal === 'devolver' && (
        <ModalTexto titulo='↩︎ Devolver a la jefatura evaluadora' etiqueta='Qué debe corregir' min={15} guardando={guardando} textoBoton='Devolver evaluación'
          descripcion='La evaluación vuelve a borrador para que la jefatura la corrija y la envíe de nuevo. Al reenviarla se recalcula la Dimensión 2. Queda registro de la devolución y de los valores anteriores.'
          onCerrar={()=>setModal(null)} onConfirmar={devolver}/>
      )}
      {modal === 'corregir' && <ModalCorreccion ev={ev} guardando={guardando} onCerrar={()=>setModal(null)} onGuardar={guardarCorreccion}/>}
      {modal === 'recalcular' && (
        <ModalRecalcular ev={ev} proc={proc} cu={cu} setMsg={setMsg} onCerrar={()=>setModal(null)}
          onHecho={async()=>{ setModal(null); await cargar(); setMsg?.({ tipo:'ok', txt:'Dimensión 2 recalculada' }) }}/>
      )}
    </div>
  )
}

// ─── Perfil por grupo de competencias ─────────────────────────────────────────
function perfilCompetencias(respuestas) {
  return COMPETENCIAS.map(g => {
    let acc = 0, peso = 0
    for (const it of g.items) {
      const p = respuestas?.items?.[it.k]?.p
      if (p == null) continue
      acc += p * (it.w||1); peso += (it.w||1)
    }
    return { l: g.g, v: peso ? r2(acc/peso) : 0 }
  })
}

// ─── Riel de progreso del formulario ──────────────────────────────────────────
function ProgressRail({ notaTec, notaFinal, itemsDone, itemsTotal, ctlDone, ctlTotal, formalOk, formalNota, dim3Done }) {
  const Paso = ({ ok, parcial, l, sub }) => (
    <div style={{display:'flex',alignItems:'center',gap:8,flex:1,minWidth:150}}>
      <span style={{width:26,height:26,borderRadius:100,flexShrink:0,display:'inline-flex',alignItems:'center',justifyContent:'center',
        fontSize:12,fontWeight:800,
        background: ok ? '#34C759' : parcial ? '#FF950020' : 'var(--bg-app)',
        color: ok ? 'white' : parcial ? '#FF9500' : 'var(--text-muted)',
        border: ok ? 'none' : `1.5px solid ${parcial ? '#FF9500' : 'var(--border)'}`}}>
        {ok ? '✓' : parcial ? '…' : ''}
      </span>
      <div>
        <div style={{fontSize:11.5,fontWeight:700}}>{l}</div>
        <div style={{fontSize:10.5,color:'var(--text-muted)'}}>{sub}</div>
      </div>
    </div>
  )
  return (
    <div style={{position:'sticky',top:64,zIndex:40,background:'var(--bg-surface)',border:'1px solid var(--border)',
      borderRadius:12,padding:'11px 16px',marginBottom:18,display:'flex',alignItems:'center',gap:14,flexWrap:'wrap',
      boxShadow:'0 4px 14px rgba(0,0,0,0.06)'}}>
      <GaugeNota nota={notaFinal ?? notaTec} label={notaFinal!=null?'proyección':'técnica'}/>
      <Paso ok={itemsDone===itemsTotal} parcial={itemsDone>0} l='1 · Técnica' sub={`${itemsDone}/${itemsTotal} competencias`}/>
      <Paso ok={ctlDone===ctlTotal} parcial={ctlDone>0} l='Control de sesgo' sub={`${ctlDone}/${ctlTotal} respondidas`}/>
      <Paso ok={!!formalOk} parcial={false} l='2 · Formal' sub={formalOk ? `automática · ${formalNota?.toFixed(2)}` : 'automática'}/>
      <Paso ok={dim3Done} parcial={false} l='3 · Continuidad' sub={dim3Done?'lista':'recomendación + justificación'}/>
    </div>
  )
}

// ─── Medidor circular de nota ─────────────────────────────────────────────────
function GaugeNota({ nota, label }) {
  const n = nota != null ? Number(nota) : null
  const pct = n != null ? n/5 : 0
  const c = n != null ? categoriaDe(n).c : 'var(--border)'
  const R = 21, C = 2*Math.PI*R
  return (
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <svg width='54' height='54' viewBox='0 0 54 54'>
        <circle cx='27' cy='27' r={R} fill='none' stroke='var(--bg-app)' strokeWidth='6'/>
        <circle cx='27' cy='27' r={R} fill='none' stroke={c} strokeWidth='6' strokeLinecap='round'
          strokeDasharray={`${C*pct} ${C}`} transform='rotate(-90 27 27)'
          style={{transition:'stroke-dasharray .4s ease, stroke .4s ease'}}/>
        <text x='27' y='31' textAnchor='middle' fontSize='13' fontWeight='800' fill={n!=null?c:'var(--text-muted)'}>
          {n!=null?n.toFixed(1):'—'}
        </text>
      </svg>
      <div style={{fontSize:10,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.04em',width:58}}>Nota {label}</div>
    </div>
  )
}

// ─── Radar SVG (4 ejes, escala 0-5) ───────────────────────────────────────────
function RadarSVG({ datos, size=200 }) {
  const cx = size/2, cy = size/2, R = size/2 - 34
  const N = datos.length
  const punto = (i, r) => {
    const a = -Math.PI/2 + (2*Math.PI*i)/N
    return [cx + r*Math.cos(a), cy + r*Math.sin(a)]
  }
  const anillos = [1,2,3,4,5].map(n =>
    Array.from({length:N},(_,i)=>punto(i, R*n/5).join(',')).join(' '))
  const poly = datos.map((d,i)=>punto(i, R*Math.max(0.04,d.v)/5).join(',')).join(' ')
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{flexShrink:0}}>
      {anillos.map((p,i)=>(
        <polygon key={i} points={p} fill='none' stroke='var(--border)' strokeWidth={i===4?1.5:0.7}/>
      ))}
      {datos.map((_,i)=>{
        const [x,y]=punto(i,R)
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke='var(--border)' strokeWidth='0.7'/>
      })}
      <polygon points={poly} fill='var(--accent)' fillOpacity='0.22' stroke='var(--accent)' strokeWidth='2' strokeLinejoin='round'/>
      {datos.map((d,i)=>{
        const [x,y]=punto(i, R*Math.max(0.04,d.v)/5)
        return <circle key={i} cx={x} cy={y} r='3.5' fill='var(--accent)'/>
      })}
      {datos.map((d,i)=>{
        const [x,y]=punto(i, R+18)
        return (
          <text key={i} x={x} y={y} textAnchor='middle' fontSize='9' fontWeight='700' fill='var(--text-muted)'>
            {d.l.length>18 ? d.l.slice(0,17)+'…' : d.l}
          </text>
        )
      })}
    </svg>
  )
}

// ─── Vista: grilla de trabajadores ────────────────────────────────────────────
function VistaTrabajadores({ cu, setMsg, procesos, onFicha, onEvaluar, alc, gestor }) {
  const [emps, setEmps] = useState([])
  const [evals, setEvals] = useState([])
  const [asigs, setAsigs] = useState([])
  const [cargosOrg, setCargosOrg] = useState([])
  const [jorn, setJorn] = useState([])
  const [cargando, setCarg] = useState(true)
  const [busq, setBusq] = useState('')
  const [fSuc, setFSuc] = useState('todas')
  const [creando, setCreando] = useState(null)
  const [verNoEval, setVerNoEval] = useState(false)   // Gestión de Personas puede ver a los no evaluables

  const procAbierto = useMemo(() => procesos.find(p=>p.estado==='abierto') || null, [procesos])
  const desde90 = useMemo(() => new Date(Date.now()-90*86400000).toISOString().slice(0,10), [])

  useEffect(() => { cargar() }, [alc?.codes])
  async function cargar() {
    setCarg(true)
    try {
      // Filtro de alcance aplicado en la consulta: las notas y categorías de
      // personas fuera del equipo no se descargan al navegador.
      const permitidos = alc?.codes ? (alc.codes.length ? alc.codes : [-1]) : null
      let qE = supabase.from('rrhh_empleados').select('cod_contaline,nombre,rut,sucursal_id,cargo,fecha_ingreso,evaluable').eq('activo',true).order('nombre')
      let qEv = supabase.from('eval_evaluaciones').select('id,proceso_id,cod_contaline,estado,nota_final,categoria,enviada_at,alertas')
      let qJ = supabase.rpc('fn_eval_asistencia_lote', { p_cods: permitidos, p_desde: desde90, p_hasta: new Date().toISOString().slice(0,10) })
      if (permitidos) {
        qE = qE.in('cod_contaline', permitidos)
        qEv = qEv.in('cod_contaline', permitidos)
      }
      const [e, ev, a, c, j] = await Promise.all([
        qE, qEv,
        supabase.from('org_asignaciones').select('cargo_id,cod_contaline,nombre_manual').eq('activo',true),
        supabase.from('org_cargos').select('id,nombre,cargo_padre_id').eq('activo',true),
        qJ,
      ])
      if (e.error) throw e.error
      setEmps(e.data||[]); setEvals(ev.data||[]); setAsigs(a.data||[]); setCargosOrg(c.data||[]); setJorn(j.data||[])
    } catch(er) { setMsg({tipo:'error', txt:er.message}) }
    finally { setCarg(false) }
  }

  const empPorCod = useMemo(()=>Object.fromEntries(emps.map(e=>[e.cod_contaline,e])),[emps])
  const cargoPorId = useMemo(()=>Object.fromEntries(cargosOrg.map(c=>[c.id,c])),[cargosOrg])

  // Jefe directo: ocupantes del cargo padre del/los cargo(s) de la persona
  const jefeDe = useMemo(() => {
    const porCargo = {}
    for (const a of asigs) (porCargo[a.cargo_id]=porCargo[a.cargo_id]||[]).push(a)
    const m = {}
    for (const a of asigs) {
      if (a.cod_contaline == null) continue
      const cargo = cargoPorId[a.cargo_id]
      const padre = cargo?.cargo_padre_id != null ? cargoPorId[cargo.cargo_padre_id] : null
      if (!padre) continue
      for (const oc of (porCargo[padre.id]||[])) {
        const nom = oc.cod_contaline != null ? empPorCod[oc.cod_contaline]?.nombre : oc.nombre_manual
        if (nom) (m[a.cod_contaline]=m[a.cod_contaline]||new Set()).add(nom)
      }
    }
    return m
  }, [asigs, cargoPorId, empPorCod])

  // Asistencia 90 días por persona
  // Asistencia validada de 90 días por persona (fn_eval_asistencia_lote): mismo criterio que la Dimensión 2
  const asis90 = useMemo(() => {
    const m = {}
    for (const r of jorn) if (!r.sin_datos) m[r.cod_contaline] = { t: r.jornadas, pctP: r.pct_puntualidad, pctA: r.pct_asistencia }
    return m
  }, [jorn])

  // Última evaluación enviada + estado en el proceso abierto
  const ultimaEval = useMemo(() => {
    const m = {}
    for (const ev of evals) {
      if (ev.estado !== 'enviada') continue
      if (!m[ev.cod_contaline] || (ev.enviada_at||'') > (m[ev.cod_contaline].enviada_at||'')) m[ev.cod_contaline] = ev
    }
    return m
  }, [evals])
  const enProcAbierto = useMemo(() => {
    if (!procAbierto) return {}
    const m = {}
    for (const ev of evals) if (ev.proceso_id === procAbierto.id && ev.estado !== 'descartada') m[ev.cod_contaline] = ev
    return m
  }, [evals, procAbierto])

  const sucsDisp = useMemo(()=>[...new Set(emps.map(e=>e.sucursal_id).filter(Boolean))].sort(),[emps])
  const lista = useMemo(() => {
    const q = busq.trim().toLowerCase()
    return emps
      .filter(e => verNoEval || e.evaluable !== false)
      .filter(e => fSuc==='todas' || e.sucursal_id===fSuc)
      .filter(e => !q || `${e.nombre} ${e.rut||''} ${e.cargo||''}`.toLowerCase().includes(q))
  }, [emps, busq, fSuc, verNoEval])
  const nNoEval = useMemo(() => emps.filter(e => e.evaluable === false).length, [emps])

  async function evaluar(emp) {
    if (!procAbierto) { setMsg({tipo:'error', txt:'No hay procesos abiertos. Crea uno en la pestaña Procesos.'}); return }
    if (emp.evaluable === false) { setMsg({tipo:'error', txt:'Esta persona está marcada como no evaluable (Dirección o socios).'}); return }
    const existente = enProcAbierto[emp.cod_contaline]
    if (existente) { onEvaluar(procAbierto, existente); return }
    setCreando(emp.cod_contaline)
    try {
      const { data, error } = await supabase.from('eval_evaluaciones').insert({
        proceso_id: procAbierto.id, cod_contaline: emp.cod_contaline, evaluador_id: cu.id,
      }).select().single()
      if (error) throw error
      onEvaluar(procAbierto, data)
    } catch(e) { setMsg({tipo:'error', txt:e.message}) }
    finally { setCreando(null) }
  }

  const pctColor = p => p>=85?'#34C759':p>=70?'#FF9500':'#FF3B30'

  return (
    <div>
      <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:12}}>
        <input value={busq} onChange={e=>setBusq(e.target.value)} placeholder='🔎 Buscar trabajador...' style={{...inpFull,maxWidth:260,width:260}}/>
        <select value={fSuc} onChange={e=>setFSuc(e.target.value)} style={{...inpFull,width:160}}>
          <option value='todas'>Todas las sucursales</option>
          {sucsDisp.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        {gestor && nNoEval > 0 && (
          <label style={{fontSize:12,color:'var(--text-muted)',display:'flex',alignItems:'center',gap:5,cursor:'pointer'}}>
            <input type='checkbox' checked={verNoEval} onChange={e=>setVerNoEval(e.target.checked)}/> Mostrar no evaluables ({nNoEval})
          </label>
        )}
        <div style={{fontSize:12,color:'var(--text-muted)',marginLeft:'auto'}}>
          {procAbierto
            ? <>Proceso abierto: <strong style={{color:'var(--text)'}}>{procAbierto.nombre}</strong></>
            : <span style={{color:'#FF9500',fontWeight:600}}>⚠️ Sin proceso abierto — crea uno para evaluar</span>}
        </div>
      </div>

      {cargando ? <div style={{padding:50,textAlign:'center',color:'var(--text-muted)'}}>Cargando...</div> : (
        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,minWidth:900}}>
            <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
              {['Trabajador','Sucursal','Depende de','Punt. 90d','Asis. 90d','Últ. evaluación','Proceso actual',''].map(h=>(
                <th key={h} style={thS}>{h}</th>))}
            </tr></thead>
            <tbody>
              {lista.map(e => {
                const a = asis90[e.cod_contaline]
                const pctP = a && a.t>0 ? a.pctP : null
                const pctA = a && a.t>0 ? a.pctA : null
                const ult = ultimaEval[e.cod_contaline]
                const enP = enProcAbierto[e.cod_contaline]
                const jefes = [...(jefeDe[e.cod_contaline]||[])]
                return (
                  <tr key={e.cod_contaline} style={{borderBottom:'1px solid var(--border)'}}>
                    <td style={tdS}>
                      <button onClick={()=>onFicha(e.cod_contaline)} style={{background:'none',border:'none',padding:0,cursor:'pointer',textAlign:'left'}}>
                        <div style={{fontWeight:700,color:'var(--accent)',fontSize:12.5}}>{e.nombre}{e.evaluable === false && <span style={badgeEgr}>NO EVALUABLE</span>}</div>
                        <div style={{fontSize:10.5,color:'var(--text-muted)'}}>{e.cargo||'—'}</div>
                      </button>
                    </td>
                    <td style={tdS}>{e.sucursal_id || '—'}</td>
                    <td style={{...tdS,fontSize:11.5}}>
                      {jefes.length===0 ? <span style={{color:'var(--text-muted)'}}>Sin vínculo</span>
                        : <>{jefes[0].split(' ').slice(0,2).join(' ')}{jefes.length>1 && <span style={{color:'var(--text-muted)'}}> +{jefes.length-1}</span>}</>}
                    </td>
                    <td style={tdS}>{pctP!=null ? <MiniPct pct={pctP} c={pctColor(pctP)}/> : <span style={{color:'var(--text-muted)',fontSize:11}}>s/d</span>}</td>
                    <td style={tdS}>{pctA!=null ? <MiniPct pct={pctA} c={pctColor(pctA)}/> : <span style={{color:'var(--text-muted)',fontSize:11}}>s/d</span>}</td>
                    <td style={tdS}>
                      {ult ? (
                        <span>
                          <strong style={{fontSize:13,color:categoriaDe(Number(ult.nota_final)).c}}>{Number(ult.nota_final).toFixed(2)}</strong>
                          <span style={{fontSize:10,color:'var(--text-muted)',marginLeft:5}}>{fFecha(ult.enviada_at)}</span>
                        </span>
                      ) : <span style={{color:'var(--text-muted)',fontSize:11}}>Nunca evaluado</span>}
                    </td>
                    <td style={tdS}>
                      {!procAbierto ? '—' :
                        enP?.estado==='enviada' ? <span style={{fontSize:10,fontWeight:800,color:'#34C759'}}>✓ EVALUADO</span> :
                        enP ? <span style={{fontSize:10,fontWeight:800,color:'#FF9500'}}>● BORRADOR</span> :
                        <span style={{fontSize:10,fontWeight:800,color:'var(--text-muted)'}}>○ PENDIENTE</span>}
                    </td>
                    <td style={{...tdS,textAlign:'right',whiteSpace:'nowrap'}}>
                      <button onClick={()=>onFicha(e.cod_contaline)} style={{...btnSec,padding:'5px 10px',fontSize:11.5,marginRight:6}}>📄 Ficha</button>
                      {procAbierto && e.evaluable !== false && enP?.estado!=='enviada' && (
                        <button onClick={()=>evaluar(e)} disabled={creando===e.cod_contaline}
                          style={{...btnPri,padding:'5px 12px',fontSize:11.5}}>
                          {enP ? 'Continuar' : 'Evaluar'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
function MiniPct({ pct, c }) {
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
      <span style={{width:44,height:6,background:'var(--bg-app)',borderRadius:100,overflow:'hidden',display:'inline-block'}}>
        <span style={{display:'block',width:`${pct}%`,height:'100%',background:c,borderRadius:100}}/>
      </span>
      <span style={{fontSize:11.5,fontWeight:800,color:c}}>{pct}%</span>
    </span>
  )
}

// ─── Ficha 360 del trabajador ─────────────────────────────────────────────────
function FichaTrabajador({ cod, setMsg, onVolver, onInforme, alc, cu, gestor }) {
  // Guard de alcance: la ficha trae historial completo de evaluaciones, así que
  // se bloquea antes de consultar nada si el trabajador no está en el equipo.
  const permitida = !alc?.codes || alc.codes.includes(cod)
  const [emp, setEmp] = useState(null)
  const [misCargos, setMisCargos] = useState([])   // cargos que ocupa
  const [jefes, setJefes] = useState([])           // ocupantes del/los cargo(s) padre
  const [equipo, setEquipo] = useState(0)          // tamaño de equipo (v_org_equipo)
  const [asis, setAsis] = useState(null)           // resumen 180 días
  const [evals, setEvals] = useState([])           // historial + proceso
  const [ants, setAnts] = useState([])             // antecedentes (Gestión de Personas)
  const [cargando, setCarg] = useState(true)
  const desde180 = useMemo(() => new Date(Date.now()-180*86400000).toISOString().slice(0,10), [])

  useEffect(() => { if (permitida) cargar(); else setCarg(false) }, [cod, permitida])
  async function cargar() {
    setCarg(true)
    try {
      const [e, a, c, j, ev, eq, va, an] = await Promise.all([
        supabase.from('rrhh_empleados').select('*').eq('cod_contaline', cod).single(),
        supabase.from('org_asignaciones').select('*').eq('activo', true),
        supabase.from('org_cargos').select('id,nombre,area,sucursal_id,cargo_padre_id').eq('activo', true),
        supabase.from('v_asis_jornadas').select('estado_dia,min_atraso_contable,min_extra_dia')
          .eq('cod_contaline', cod).gte('fecha', desde180).limit(20000),
        supabase.from('eval_evaluaciones').select('*, eval_procesos(*)').eq('cod_contaline', cod).neq('estado', 'descartada').order('created_at', {ascending:false}),
        supabase.from('v_org_equipo').select('cod_miembro').eq('cod_jefe', cod),
        supabase.rpc('fn_eval_asistencia', { p_cod: cod, p_desde: desde180, p_hasta: new Date().toISOString().slice(0,10) }),
        supabase.from('rrhh_antecedentes').select('id,fecha,tipo,motivo,registrado_por,created_at').eq('cod_contaline', cod).eq('activo', true).order('fecha', { ascending:false }),
      ])
      if (e.error) throw e.error
      setEmp(e.data)
      const cargoPorId = Object.fromEntries((c.data||[]).map(x=>[x.id,x]))
      const asigs = a.data||[]
      const mios = asigs.filter(x=>x.cod_contaline===cod).map(x=>cargoPorId[x.cargo_id]).filter(Boolean)
      setMisCargos(mios)
      const padres = [...new Set(mios.map(x=>x.cargo_padre_id).filter(p=>p!=null))]
      const nomsJefes = new Set()
      const codsEmp = [...new Set(asigs.filter(x=>padres.includes(x.cargo_id)).map(x=>x.cod_contaline).filter(Boolean))]
      let empsJefes = []
      if (codsEmp.length) {
        const { data } = await supabase.from('rrhh_empleados').select('cod_contaline,nombre,cargo').in('cod_contaline', codsEmp)
        empsJefes = data||[]
      }
      for (const x of asigs.filter(x=>padres.includes(x.cargo_id))) {
        const nom = x.cod_contaline != null ? empsJefes.find(y=>y.cod_contaline===x.cod_contaline)?.nombre : x.nombre_manual
        if (nom) nomsJefes.add(`${nom}|${cargoPorId[x.cargo_id]?.nombre||''}`)
      }
      setJefes([...nomsJefes].map(s=>{ const [n,cg]=s.split('|'); return {nombre:n, cargo:cg} }))
      setEquipo(Math.max(0, (eq.data||[]).filter(m=>m.cod_miembro!==cod).length))

      const rows = (j.data||[]).filter(r=>r.estado_dia!=='sin_turno')
      if (rows.length) {
        const cnt = k => rows.filter(r=>r.estado_dia===k).length
        const punt = cnt('puntual')+cnt('hizo_extra')
        setAsis({
          total: rows.length,
          // % de puntualidad y asistencia con el criterio validado (igual que la Dimensión 2)
          pctP: va?.data && !va.data.sinDatos ? va.data.pctPuntualidad : Math.round(punt/rows.length*100),
          pctA: va?.data && !va.data.sinDatos ? va.data.pctAsistencia : Math.round((rows.length-cnt('sin_marcas'))/rows.length*100),
          faltasInjust: va?.data && !va.data.sinDatos ? va.data.ausencias : null,
          dist: { puntual:cnt('puntual'), hizo_extra:cnt('hizo_extra'), atraso:cnt('atraso'),
                  salida_anticipada:cnt('salida_anticipada'), incompleta:cnt('incompleta'),
                  sin_marcas:cnt('sin_marcas'), turno_corrido:cnt('turno_corrido') },
          minAtraso: rows.reduce((s,r)=>s+(r.min_atraso_contable||0),0),
          minExtra:  rows.reduce((s,r)=>s+(r.min_extra_dia||0),0),
        })
      } else setAsis({ sinDatos:true })
      setEvals(ev.data||[])
      setAnts(an?.error ? [] : (an?.data || []))
    } catch(er) { setMsg({tipo:'error', txt:er.message}) }
    finally { setCarg(false) }
  }

  async function cargarAnts() {
    const { data, error } = await supabase.from('rrhh_antecedentes').select('id,fecha,tipo,motivo,registrado_por,created_at')
      .eq('cod_contaline', cod).eq('activo', true).order('fecha', { ascending:false })
    setAnts(error ? [] : (data || []))
  }

  async function toggleEvaluable() {
    const nuevo = emp?.evaluable === false
    const { error } = await supabase.from('rrhh_empleados').update({ evaluable: nuevo }).eq('cod_contaline', cod)
    if (error) { setMsg({tipo:'error', txt:error.message}); return }
    setEmp(e => ({ ...e, evaluable: nuevo }))
    setMsg({tipo:'ok', txt: nuevo ? 'Vuelve a estar en el universo evaluable.' : 'Marcado como no evaluable: ya no aparece en Trabajadores ni como candidato en los procesos.'})
  }

  const DIST_C = { puntual:'#34C759', hizo_extra:'#0A84FF', atraso:'#FF9500', salida_anticipada:'#FF6B22',
    incompleta:'#AF52DE', sin_marcas:'#FF3B30', turno_corrido:'#8E8E93' }
  const DIST_L = { puntual:'Puntual', hizo_extra:'Con extra', atraso:'Atraso', salida_anticipada:'Salida ant.',
    incompleta:'Incompleta', sin_marcas:'Ausencia', turno_corrido:'T. corrido' }

  if (!permitida) return (
    <div>
      <button onClick={onVolver} style={{...btnSec,marginBottom:14}}>&larr; Trabajadores</button>
      <div style={{maxWidth:480,margin:'40px auto',textAlign:'center',background:'var(--bg-surface)',
        border:'1px solid var(--border)',borderRadius:16,padding:'36px 28px'}}>
        <div style={{fontSize:44,marginBottom:12}}>🔒</div>
        <h3 style={{margin:'0 0 8px 0'}}>Ficha fuera de tu alcance</h3>
        <p style={{color:'var(--text-muted)',fontSize:13,margin:0}}>
          Solo puedes ver las fichas de los trabajadores de tu equipo directo.
        </p>
      </div>
    </div>
  )
  if (cargando) return <div style={{padding:60,textAlign:'center',color:'var(--text-muted)'}}>Cargando ficha...</div>

  return (
    <div style={{maxWidth:900,margin:'0 auto'}}>
      <button onClick={onVolver} style={{...btnSec,marginBottom:14}}>&larr; Trabajadores</button>

      {/* Encabezado — datos */}
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:14,padding:'16px 20px',marginBottom:14}}>
        <div style={{display:'flex',gap:14,alignItems:'center',flexWrap:'wrap'}}>
          <span style={{width:52,height:52,borderRadius:100,background:'var(--accent)',color:'white',fontSize:17,fontWeight:800,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            {String(emp?.nombre||'?').trim().split(/\s+/).slice(0,2).map(p=>p[0]).join('').toUpperCase()}
          </span>
          <div style={{flex:1}}>
            <div style={{fontSize:18,fontWeight:800}}>{emp?.nombre}{emp?.evaluable === false && <span style={badgeEgr}>NO EVALUABLE</span>}</div>
            {gestor && emp && (
              <button onClick={toggleEvaluable} style={{...btnGhost,padding:'2px 9px',fontSize:11,marginTop:3}}
                title='Dirección y socios no se evalúan: quedan fuera de la lista de Trabajadores y de los candidatos de cada proceso'>
                {emp.evaluable === false ? 'Volver a incluir en la evaluación' : 'Marcar como no evaluable'}
              </button>
            )}
            <div style={{fontSize:12,color:'var(--text-muted)',marginTop:2}}>
              {emp?.cargo || 'Sin cargo contractual'} · <strong style={{color:'var(--accent)'}}>{emp?.sucursal_id||'—'}</strong> · RUT {emp?.rut||'—'} · Ingreso {fFecha(emp?.fecha_ingreso)}
            </div>
          </div>
          {equipo > 0 && (
            <div style={{textAlign:'center',padding:'6px 16px',background:'var(--bg-app)',borderRadius:10}}>
              <div style={{fontSize:19,fontWeight:800}}>{equipo}</div>
              <div style={{fontSize:9.5,color:'var(--text-muted)',fontWeight:700,textTransform:'uppercase'}}>a su cargo</div>
            </div>
          )}
        </div>
      </div>

      {/* Jerarquía */}
      <div style={secTituloI}>Posición en el organigrama</div>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'13px 16px',marginBottom:14,display:'grid',gap:8}}>
        <div style={{fontSize:12.5}}>
          <span style={{color:'var(--text-muted)'}}>Cargo(s) en el organigrama: </span>
          {misCargos.length ? misCargos.map(c=>(
            <span key={c.id} style={{fontWeight:700,marginRight:8}}>{c.nombre}{c.sucursal_id?` (${c.sucursal_id})`:''}</span>
          )) : <span style={{fontStyle:'italic',color:'var(--text-muted)'}}>sin vincular — usa la pestaña Pendientes del Organigrama</span>}
        </div>
        <div style={{fontSize:12.5}}>
          <span style={{color:'var(--text-muted)'}}>Depende de: </span>
          {jefes.length ? jefes.map((jf,i)=>(
            <span key={i} style={{fontWeight:700,marginRight:8}}>{jf.nombre}<span style={{color:'var(--text-muted)',fontWeight:500}}> ({jf.cargo})</span></span>
          )) : <span style={{fontStyle:'italic',color:'var(--text-muted)'}}>—</span>}
        </div>
      </div>

      {/* Asistencia 180 días */}
      <div style={secTituloI}>Asistencia — últimos 6 meses</div>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'13px 16px',marginBottom:14}}>
        {asis?.sinDatos ? <div style={{fontSize:12.5,color:'var(--text-muted)'}}>Sin jornadas con turno en el período.</div> : (
          <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:10,marginBottom:12}}>
              <Metrica l='Jornadas' v={asis.total}/>
              <Metrica l='Puntualidad' v={`${asis.pctP}%`} c={asis.pctP>=85?'#34C759':asis.pctP>=70?'#FF9500':'#FF3B30'}/>
              <Metrica l='Asistencia' v={`${asis.pctA}%`} c={asis.pctA>=92?'#34C759':asis.pctA>=84?'#FF9500':'#FF3B30'}/>
              <Metrica l='Min. atraso' v={asis.minAtraso}/>
              <Metrica l='Min. extra' v={asis.minExtra}/>
            </div>
            <div style={{display:'flex',height:14,borderRadius:100,overflow:'hidden',marginBottom:8}}>
              {Object.entries(asis.dist).filter(([,n])=>n>0).map(([k,n])=>(
                <span key={k} title={`${DIST_L[k]}: ${n}`} style={{width:`${n/asis.total*100}%`,background:DIST_C[k]}}/>
              ))}
            </div>
            <div style={{display:'flex',gap:12,flexWrap:'wrap',fontSize:10.5,color:'var(--text-muted)'}}>
              {Object.entries(asis.dist).filter(([,n])=>n>0).map(([k,n])=>(
                <span key={k}><span style={{display:'inline-block',width:8,height:8,borderRadius:100,background:DIST_C[k],marginRight:4}}/>{DIST_L[k]} {n}</span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Antecedentes: retroalimentaciones, amonestaciones, compromisos (Gestión de Personas) */}
      <div style={secTituloI}>Antecedentes ({ants.length})</div>
      <PanelAntecedentes cod={cod} items={ants} editable={!!gestor} cu={cu} setMsg={setMsg} onCambio={cargarAnts}
        nota='Retroalimentaciones, amonestaciones, compromisos y reconocimientos registrados por Gestión de Personas. No afectan la nota: se incluyen en el informe de cada evaluación cuyo período los contiene.'/>

      {/* Historial de evaluaciones */}
      <div style={secTituloI}>Evaluaciones de desempeño ({evals.length})</div>
      <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,overflow:'hidden',marginBottom:24}}>
        {evals.length === 0 ? (
          <div style={{padding:'18px 16px',fontSize:12.5,color:'var(--text-muted)'}}>Sin evaluaciones registradas.</div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
            <thead><tr style={{borderBottom:'1px solid var(--border)'}}>
              {['Proceso','Estado','Nota','Categoría','Alertas','Fecha','Retro.',''].map(h=><th key={h} style={thS}>{h}</th>)}
            </tr></thead>
            <tbody>
              {evals.map(ev=>(
                <tr key={ev.id} style={{borderBottom:'1px solid var(--border)'}}>
                  <td style={tdS}>{ev.eval_procesos?.nombre || `Proceso ${ev.proceso_id}`}</td>
                  <td style={tdS}>
                    <span style={{fontSize:10,fontWeight:800,color:ev.estado==='enviada'?'#34C759':'#FF9500'}}>
                      {ev.estado==='enviada'?'✓ ENVIADA':'● BORRADOR'}
                    </span>
                  </td>
                  <td style={{...tdS,fontWeight:800,fontSize:13.5}}>{ev.nota_final!=null?Number(ev.nota_final).toFixed(2):'—'}</td>
                  <td style={tdS}>{ev.categoria ? <span style={{fontSize:11,fontWeight:700,color:categoriaDe(Number(ev.nota_final)).c}}>{ev.categoria}</span> : '—'}</td>
                  <td style={tdS}>{(ev.alertas||[]).length>0 ? <span style={{color:'#FF9500',fontWeight:700}}>⚠️ {ev.alertas.length}</span> : ev.estado==='enviada'?'✓':'—'}</td>
                  <td style={{...tdS,fontSize:11.5,color:'var(--text-muted)'}}>{fFecha(ev.enviada_at || ev.created_at)}</td>
                  <td style={{...tdS,fontSize:11.5,whiteSpace:'nowrap'}}>{ev.retro_fecha ? <span style={{color:'#34C759',fontWeight:700}}>✓ {fFecha(ev.retro_fecha)}</span> : ev.estado==='enviada' ? <span style={{color:'var(--text-muted)'}}>Pendiente</span> : '—'}</td>
                  <td style={{...tdS,textAlign:'right'}}>
                    {ev.estado==='enviada' && ev.eval_procesos && (
                      <button onClick={()=>onInforme(ev.eval_procesos, ev)} style={{...btnSec,padding:'4px 10px',fontSize:11.5}}>📄 Informe</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Dimensión 2: qué excluyó o marcó el criterio vigente ─────────────────────
function ResumenCriterioD2({ snap }) {
  if (!snap || (snap.version || 1) < 2) return null
  const tol = snap.parametros?.toleranciaMin ?? 5, atip = snap.parametros?.atipicoMin ?? 120, tope = snap.parametros?.topeMensualMin ?? 60
  const items = [
    snap.enTolerancia > 0 && `${snap.enTolerancia} atraso(s) dentro de la tolerancia del art. 27 del Reglamento Interno (hasta ${tol} min): no cuentan.`,
    snap.excesoTolerancia > 0 && `${snap.excesoTolerancia} min de atrasos tolerados superan el tope mensual de ${tope} min (art. 27): sí cuentan como atraso.`,
    snap.atipicos > 0 && `${snap.atipicos} error(es) de marcaje excluido(s) de la puntualidad (sin marca de entrada, marca única cercana a la salida o día de enrolamiento en el reloj).`,
    snap.sinRegistro?.dias > 0 && `${snap.sinRegistro.dias} jornada(s) sin registro biométrico (${fFecha(snap.sinRegistro.desde)} a ${fFecha(snap.sinRegistro.hasta)}, antes de su primera marca del ${fFecha(snap.sinRegistro.primeraMarca)}): no cuentan como ausencia.`,
  ].filter(Boolean)
  return (
    <>
      {items.length > 0 && (
        <ul style={{margin:'10px 0 0 0',paddingLeft:18,fontSize:11.5,color:'var(--text-muted)',lineHeight:1.55}}>
          {items.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      )}
      {snap.atrasosExtremos > 0 && (
        <div style={{...avisoS,marginTop:10}}>
          <strong>{snap.atrasosExtremos} atraso(s) de más de {atip} min con entrada y salida marcadas.</strong> Se cuentan como atraso.
          Si el turno asignado esos días no corresponde, Gestión de Personas debe corregirlo en Control de Asistencia y recalcular esta dimensión antes de la retroalimentación.
        </div>
      )}
    </>
  )
}

// ─── Plan de mejora: edición y lectura ────────────────────────────────────────
function EditorPlan({ plan, onChange, requerido, motivo, onQuitar }) {
  const comps = plan?.compromisos?.length ? plan.compromisos : PLAN_VACIO().compromisos
  const base = { ...(plan || {}), compromisos: comps }
  const setC = (i, k, v) => onChange({ ...base, compromisos: comps.map((c, j) => j === i ? { ...c, [k]: v } : c) })
  return (
    <div style={{background:'var(--bg-surface)',border:`1px solid ${requerido ? '#FF950060' : 'var(--border)'}`,borderRadius:12,padding:'14px 16px',marginBottom:20}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10,flexWrap:'wrap',marginBottom:4}}>
        <div style={{fontSize:13.5,fontWeight:800}}>
          📈 Plan de mejora
          <span style={{marginLeft:8,fontSize:10,fontWeight:800,padding:'2px 8px',borderRadius:100,
            background: requerido ? '#FF950018' : '#8E8E9318', color: requerido ? '#FF9500' : '#8E8E93'}}>
            {requerido ? 'OBLIGATORIO' : 'OPCIONAL'}
          </span>
        </div>
        {!requerido && onQuitar && <button onClick={onQuitar} style={{...btnGhost,padding:'4px 10px',fontSize:11.5}}>Quitar plan</button>}
      </div>
      {motivo && <div style={{fontSize:11.5,color:'var(--text-muted)',marginBottom:10}}>{motivo} El plan queda en el informe que firma el trabajador.</div>}
      <div style={{display:'grid',gap:10}}>
        {comps.map((c, i) => (
          <div key={i} style={{background:'var(--bg-app)',borderRadius:10,padding:'10px 12px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
              <strong style={{fontSize:12}}>Compromiso {i + 1}</strong>
              {comps.length > 2 && (
                <button onClick={()=>onChange({ ...base, compromisos: comps.filter((_, j) => j !== i) })}
                  style={{background:'none',border:'none',color:'#FF3B30',cursor:'pointer',fontSize:11.5}}>Quitar</button>
              )}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:8}}>
              {Object.entries(PLAN_CAMPOS).map(([k, l]) => (
                <div key={k}>
                  <label style={lblM}>{l}</label>
                  <textarea {...ORTO} rows={2} value={c[k] || ''} onChange={e=>setC(i, k, e.target.value)}
                    placeholder={k === 'conducta' ? 'Qué debe hacer distinto (observable)' : k === 'apoyo' ? 'Qué hará la jefatura para apoyarlo' : 'Indicador o evidencia que se revisará'}
                    style={{...inpFull,resize:'vertical',fontFamily:'inherit'}}/>
                </div>
              ))}
            </div>
            <div style={{marginTop:6,maxWidth:200}}>
              <label style={lblM}>Plazo</label>
              <input type='date' value={c.plazo || ''} onChange={e=>setC(i, 'plazo', e.target.value)} style={inpFull}/>
            </div>
          </div>
        ))}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:10,flexWrap:'wrap',marginTop:10}}>
        {comps.length < 3
          ? <button onClick={()=>onChange({ ...base, compromisos:[...comps, compVacio()] })} style={{...btnSec,padding:'6px 12px',fontSize:12}}>＋ Agregar compromiso</button>
          : <span/>}
        <div style={{width:220}}>
          <label style={lblM}>Fecha de reevaluación</label>
          <input type='date' value={base.reevaluacion || ''} onChange={e=>onChange({ ...base, reevaluacion: e.target.value })} style={inpFull}/>
        </div>
      </div>
    </div>
  )
}
function PlanLectura({ plan }) {
  const comps = (plan?.compromisos || []).filter(compConDatos)
  return (
    <div>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr>{['#','Conducta esperada','Apoyo de la jefatura','Cómo se medirá','Plazo'].map(h => <th key={h} style={{...thS,padding:'6px 8px'}}>{h}</th>)}</tr></thead>
          <tbody>
            {comps.map((c, i) => (
              <tr key={i} style={{borderTop:'1px solid var(--border)',verticalAlign:'top'}}>
                <td style={{padding:'6px 8px',width:20}}>{i + 1}</td>
                <td style={{padding:'6px 8px'}}>{c.conducta}</td>
                <td style={{padding:'6px 8px'}}>{c.apoyo}</td>
                <td style={{padding:'6px 8px'}}>{c.medicion}</td>
                <td style={{padding:'6px 8px',whiteSpace:'nowrap'}}>{fFecha(c.plazo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{fontSize:12,marginTop:8}}><strong>Fecha de reevaluación:</strong> {fFecha(plan?.reevaluacion)}</div>
    </div>
  )
}

// ─── Antecedentes (los registra Gestión de Personas; no afectan la nota) ──────
function PanelAntecedentes({ cod, items, editable, cu, setMsg, onCambio, desde, hasta, nota }) {
  const [form, setForm] = useState(null)
  const [anular, setAnular] = useState(null)       // { id, motivo }
  const [g, setG] = useState(false)
  const lista = items || []
  const hoy = hoyISO()
  async function guardar() {
    const f = form || {}
    if (!f.fecha || !f.tipo || String(f.motivo || '').trim().length < 10) { setMsg?.({ tipo:'error', txt:'Completa la fecha, el tipo y un motivo resumido (mín. 10 caracteres).' }); return }
    if (f.fecha > hoy) { setMsg?.({ tipo:'error', txt:'La fecha del antecedente no puede ser futura.' }); return }
    if ((desde && f.fecha < desde) || (hasta && f.fecha > hasta)) {
      setMsg?.({ tipo:'error', txt:`La fecha debe estar dentro del período del proceso (${fFecha(desde)} a ${fFecha(hasta)}). Para otras fechas, regístralo desde la ficha del trabajador.` }); return
    }
    setG(true)
    const { error } = await supabase.from('rrhh_antecedentes').insert({
      cod_contaline: cod, fecha: f.fecha, tipo: f.tipo, motivo: f.motivo.trim(), registrado_por: cu?.id || null,
    })
    setG(false)
    if (error) {
      setMsg?.({ tipo:'error', txt: /row-level security|violates/i.test(error.message) ? 'Solo Gestión de Personas puede registrar antecedentes.' : error.message }); return
    }
    setForm(null); setMsg?.({ tipo:'ok', txt:'Antecedente registrado' }); onCambio?.()
  }
  async function confirmarAnular() {
    if (String(anular?.motivo || '').trim().length < 5) { setMsg?.({ tipo:'error', txt:'Indica el motivo de la anulación (mín. 5 caracteres).' }); return }
    setG(true)
    const { error } = await supabase.from('rrhh_antecedentes').update({
      activo:false, anulado_por: cu?.id || null, anulado_at: new Date().toISOString(), anulado_motivo: anular.motivo.trim(),
    }).eq('id', anular.id)
    setG(false)
    if (error) { setMsg?.({ tipo:'error', txt:error.message }); return }
    setAnular(null); setMsg?.({ tipo:'ok', txt:'Antecedente anulado (queda registro)' }); onCambio?.()
  }
  return (
    <div style={cardS}>
      {nota && <div style={{fontSize:11.5,color:'var(--text-muted)',marginBottom:10}}>{nota}</div>}
      {lista.length === 0
        ? <div style={{fontSize:12.5,color:'var(--text-muted)'}}>Sin antecedentes registrados{desde ? ' en el período' : ''}.</div>
        : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <tbody>
              {lista.map(a => (
                <tr key={a.id} style={{borderTop:'1px solid var(--border)',verticalAlign:'top'}}>
                  <td style={{padding:'6px 8px',width:90,whiteSpace:'nowrap'}}>{fFecha(a.fecha)}</td>
                  <td style={{padding:'6px 8px',width:150,whiteSpace:'nowrap'}}><span style={{fontSize:11.5,fontWeight:700,color:COLOR_ANT[a.tipo]||'var(--text)'}}>{tipoAntL(a.tipo)}</span></td>
                  <td style={{padding:'6px 8px'}}>{a.motivo}</td>
                  <td style={{padding:'6px 8px',width:60,textAlign:'right'}}>
                    {editable && <button onClick={()=>setAnular({ id:a.id, motivo:'' })} style={{background:'none',border:'none',color:'#FF3B30',cursor:'pointer',fontSize:11.5}}>Anular</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      {anular && (
        <div style={{display:'flex',gap:8,alignItems:'center',marginTop:10,flexWrap:'wrap'}}>
          <input {...ORTO} value={anular.motivo} onChange={e=>setAnular(a=>({ ...a, motivo:e.target.value }))}
            placeholder='Motivo de la anulación (queda registro)' style={{...inpFull,flex:1,minWidth:240}}/>
          <button onClick={()=>setAnular(null)} disabled={g} style={{...btnSec,padding:'6px 12px',fontSize:12}}>Cancelar</button>
          <button onClick={confirmarAnular} disabled={g} style={{...btnPri,background:'#FF3B30',padding:'6px 12px',fontSize:12}}>Anular</button>
        </div>
      )}
      {editable && !form && !anular && (
        <button onClick={()=>setForm({ fecha: (hasta && hoy > hasta) ? hasta : hoy, tipo:'retroalimentacion', motivo:'' })}
          style={{...btnSec,marginTop:10,padding:'6px 12px',fontSize:12}}>＋ Registrar antecedente</button>
      )}
      {form && (
        <div style={{marginTop:10,display:'grid',gap:8,background:'var(--bg-app)',borderRadius:10,padding:'10px 12px'}}>
          <div style={{display:'grid',gridTemplateColumns:'160px 220px',gap:8}}>
            <div><label style={lblM}>Fecha</label>
              <input type='date' value={form.fecha} max={hoy} min={desde || undefined} onChange={e=>setForm(f=>({ ...f, fecha:e.target.value }))} style={inpFull}/></div>
            <div><label style={lblM}>Tipo</label>
              <select value={form.tipo} onChange={e=>setForm(f=>({ ...f, tipo:e.target.value }))} style={inpFull}>
                {TIPOS_ANT.map(t => <option key={t.k} value={t.k}>{t.l}</option>)}
              </select></div>
          </div>
          <div><label style={lblM}>Motivo resumido</label>
            <textarea {...ORTO} rows={2} value={form.motivo} onChange={e=>setForm(f=>({ ...f, motivo:e.target.value }))}
              placeholder='Ej: Amonestación escrita por tres atrasos reiterados en septiembre; compromiso de puntualidad firmado.'
              style={{...inpFull,resize:'vertical',fontFamily:'inherit'}}/></div>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
            <button onClick={()=>setForm(null)} disabled={g} style={{...btnSec,padding:'6px 12px',fontSize:12}}>Cancelar</button>
            <button onClick={guardar} disabled={g} style={{...btnPri,padding:'6px 12px',fontSize:12}}>{g ? 'Guardando...' : 'Guardar antecedente'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Revisión ortográfica (diccionario local de español de Chile) ─────────────
function ModalOrtografia({ campos, modo, onCerrar, onContinuar }) {
  const [mod, setMod] = useState(null)
  const [sp, setSp] = useState(null)
  const [error, setError] = useState(null)
  const [ignoradas, setIgnoradas] = useState(() => new Set())
  const [ver, setVer] = useState(0)
  useEffect(() => {
    let c = false
    ;(async () => {
      try { const m = await import('./ortografia'); const s = await m.cargarCorrector(); if (!c) { setMod(m); setSp(s) } }
      catch(e) { if (!c) setError('No se pudo cargar el corrector ortográfico.') }
    })()
    return () => { c = true }
  }, [])
  const hallazgos = useMemo(() => (mod && sp) ? mod.revisarCampos(sp, campos, ignoradas) : [], [mod, sp, campos, ignoradas, ver])
  const grupos = useMemo(() => {
    const m = new Map()
    for (const h of hallazgos) { if (!m.has(h.campo)) m.set(h.campo, { l:h.campoL, items:[] }); m.get(h.campo).items.push(h) }
    return [...m.entries()]
  }, [hallazgos])
  const campoPorId = Object.fromEntries((campos || []).map(c => [c.id, c]))
  const corregir = (h, s) => { const c = campoPorId[h.campo]; if (c?.set) c.set(mod.reemplazar(c.texto, h.palabra, s)) }
  const cargando = !sp && !error
  return (
    <Overlay onCerrar={onCerrar} ancho={660}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>🔤 Revisión ortográfica</div>
      <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12,lineHeight:1.5}}>
        El trabajador firma este documento. Haz clic en una sugerencia para corregir la palabra en el texto.
        El corrector funciona en tu navegador: los textos no se envían a ningún servicio externo.
        No detecta tildes que cambian el sentido (esta/está, mas/más, solo/sólo): revisa esos casos tú.
      </div>
      {cargando ? <div style={{padding:24,textAlign:'center',color:'var(--text-muted)'}}>Cargando diccionario…</div>
      : error ? <div style={{...avisoS}}>⚠️ {error} Puedes continuar igual.</div>
      : hallazgos.length === 0 ? (
        <div style={{padding:'12px 14px',borderRadius:10,background:'#34C75912',border:'1px solid #34C75935',color:'#1E7A44',fontSize:13,fontWeight:600}}>
          ✓ Sin errores ortográficos detectados.
        </div>
      ) : (
        <div style={{display:'grid',gap:12,maxHeight:'52vh',overflowY:'auto'}}>
          <div style={{fontSize:12,fontWeight:700,color:'#FF3B30'}}>{hallazgos.length} palabra(s) por revisar</div>
          {grupos.map(([id, g]) => (
            <div key={id}>
              <div style={{fontSize:11,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em',marginBottom:6}}>{g.l}</div>
              <div style={{display:'grid',gap:6}}>
                {g.items.map(h => {
                  const sugs = mod.sugerir(sp, h.palabra)
                  return (
                    <div key={h.palabra} style={{background:'var(--bg-app)',borderRadius:8,padding:'8px 10px'}}>
                      <div style={{fontSize:12,marginBottom:6}}>
                        <strong style={{color:'#FF3B30'}}>{h.palabra}</strong> <span style={{color:'var(--text-muted)'}}>· {h.contexto}</span>
                      </div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {sugs.map(s => <button key={s} onClick={()=>corregir(h, s)} style={{...btnPri,padding:'4px 10px',fontSize:12}}>{s}</button>)}
                        {sugs.length === 0 && <span style={{fontSize:11.5,color:'var(--text-muted)',alignSelf:'center'}}>Sin sugerencias: corrígela en el texto.</span>}
                        <button onClick={()=>setIgnoradas(s => new Set([...s, h.palabra.toLowerCase()]))} style={{...btnSec,padding:'4px 10px',fontSize:12}}>Ignorar</button>
                        <button onClick={()=>{ mod.agregarPersonal(sp, h.palabra); setVer(v => v + 1) }} style={{...btnGhost,padding:'4px 10px',fontSize:12}} title='La palabra es correcta: no volver a marcarla en este navegador'>Agregar al diccionario</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
        <button onClick={onCerrar} style={btnSec}>{onContinuar ? 'Volver al formulario' : 'Cerrar'}</button>
        {onContinuar && <button onClick={onContinuar} disabled={cargando} style={btnPri}>{hallazgos.length ? 'Enviar de todos modos' : '✓ Enviar evaluación'}</button>}
      </div>
    </Overlay>
  )
}

// ─── Modales de Gestión de Personas ───────────────────────────────────────────
function ModalTexto({ titulo, descripcion, etiqueta, min = 10, onCerrar, onConfirmar, guardando, textoBoton }) {
  const [t, setT] = useState('')
  const ok = t.trim().length >= min
  return (
    <Overlay onCerrar={onCerrar}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>{titulo}</div>
      <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12,lineHeight:1.5}}>{descripcion}</div>
      <label style={lblM}>{etiqueta}</label>
      <textarea {...ORTO} rows={4} value={t} onChange={e=>setT(e.target.value)} style={{...inpFull,resize:'vertical',fontFamily:'inherit'}}/>
      <div style={{fontSize:10.5,color:ok?'var(--success,#34C759)':'var(--text-muted)',marginTop:3}}>{t.trim().length}/{min} caracteres mínimos</div>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:14}}>
        <button onClick={onCerrar} disabled={guardando} style={btnSec}>Cancelar</button>
        <button onClick={()=>ok && onConfirmar(t.trim())} disabled={!ok || guardando} style={{...btnPri,opacity:ok?1:0.5}}>{guardando ? 'Guardando...' : textoBoton}</button>
      </div>
    </Overlay>
  )
}
function ModalCorreccion({ ev, onCerrar, onGuardar, guardando }) {
  const base = useMemo(() => {
    const c = []
    if (ev.justificacion) c.push({ id:'justif', l:'Justificación de la recomendación', v:ev.justificacion })
    const L = { c_errores:'Errores del período declarados', c_aportes:'Aportes del período declarados', c_relacion_det:'Relación personal declarada' }
    for (const k of Object.keys(L)) if (ev.respuestas?.control?.[k]) c.push({ id:k, l:L[k], v:ev.respuestas.control[k] })
    for (const it of ITEMS) { const t = ev.respuestas?.items?.[it.k]?.ev; if (t) c.push({ id:`ev_${it.k}`, l:`Evidencia · ${it.l}`, v:t }) }
    return c
  }, [ev])
  const [txt, setTxt] = useState(() => Object.fromEntries(base.map(c => [c.id, c.v])))
  const [orto, setOrto] = useState(false)
  const campos = base.map(c => ({ id:c.id, l:c.l, texto:txt[c.id], set:v => setTxt(t => ({ ...t, [c.id]: v })) }))
  const nCambios = base.filter(c => txt[c.id] !== c.v).length
  const error = base.some(c => !String(txt[c.id] || '').trim()) ? 'Ningún texto puede quedar vacío.'
    : (txt.justif != null && String(txt.justif).trim().length < 80) ? 'La justificación debe mantener al menos 80 caracteres.' : null
  return (
    <Overlay onCerrar={onCerrar} ancho={720}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>✏️ Corregir redacción</div>
      <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12,lineHeight:1.5}}>
        Solo ortografía y redacción: no cambia notas ni el sentido de lo escrito por la jefatura (que firma el documento).
        Para cambios de fondo, devuelve la evaluación. Cada cambio queda registrado con el texto anterior.
      </div>
      <div style={{display:'grid',gap:10,maxHeight:'55vh',overflowY:'auto',paddingRight:4}}>
        {base.map(c => (
          <div key={c.id}>
            <label style={lblM}>{c.l}{txt[c.id] !== c.v && <span style={{color:'#FF9500',marginLeft:6}}>· modificado</span>}</label>
            <textarea {...ORTO} rows={3} value={txt[c.id] || ''} onChange={e=>setTxt(t => ({ ...t, [c.id]: e.target.value }))}
              style={{...inpFull,resize:'vertical',fontFamily:'inherit'}}/>
          </div>
        ))}
        {base.length === 0 && <div style={{fontSize:12.5,color:'var(--text-muted)'}}>La evaluación no tiene textos para corregir.</div>}
      </div>
      {error && <div style={{fontSize:12,color:'#FF3B30',marginTop:8}}>⚠️ {error}</div>}
      <div style={{display:'flex',gap:8,justifyContent:'space-between',marginTop:14,flexWrap:'wrap'}}>
        <button onClick={()=>setOrto(true)} disabled={!base.length} style={btnSec}>🔤 Revisar ortografía</button>
        <div style={{display:'flex',gap:8}}>
          <button onClick={onCerrar} disabled={guardando} style={btnSec}>Cancelar</button>
          <button onClick={()=>onGuardar(Object.fromEntries(base.map(c => [c.id, txt[c.id]])))} disabled={guardando || !!error || nCambios === 0}
            style={{...btnPri,opacity:(error || nCambios === 0) ? 0.5 : 1}}>{guardando ? 'Guardando...' : `Guardar ${nCambios} cambio${nCambios === 1 ? '' : 's'}`}</button>
        </div>
      </div>
      {orto && <ModalOrtografia campos={campos} modo='manual' onCerrar={()=>setOrto(false)}/>}
    </Overlay>
  )
}
function ModalRecalcular({ ev, proc, cu, setMsg, onCerrar, onHecho }) {
  const [proy, setProy] = useState(null)
  const [motivo, setMotivo] = useState('Turnos o marcas corregidos en Control de Asistencia.')
  const [g, setG] = useState(false)
  // Mismo período de la evaluación original: hasta el día anterior al envío
  const hasta = useMemo(() => {
    const f = ev.enviada_at ? fechaCL(ev.enviada_at) : hoyISO()
    const d = new Date(`${f}T12:00:00`); d.setDate(d.getDate() - 1)
    const h = d.toISOString().slice(0, 10)
    return h < proc.periodo_hasta ? h : proc.periodo_hasta
  }, [ev.enviada_at, proc.periodo_hasta])
  useEffect(() => { (async () => {
    const { data, error } = await supabase.rpc('fn_eval_asistencia', { p_cod: ev.cod_contaline, p_desde: proc.periodo_desde, p_hasta: hasta })
    if (error) { setProy({ error: error.message }); return }
    const nf = data?.sinDatos ? null : Number(data.nota)
    const fin = notaFinalDe(ev.nota_tecnica, nf, ev.nota_recom, proc)
    setProy({ snap: data || {}, formal: nf, final: fin, cat: fin != null ? categoriaDe(fin).l : null })
  })() }, [ev.id, hasta])
  async function aplicar() {
    if (motivo.trim().length < 10) { setMsg?.({ tipo:'error', txt:'Indica el motivo del recálculo (mín. 10 caracteres).' }); return }
    setG(true)
    const { data, error } = await supabase.rpc('fn_eval_recalcular_formal', { p_eval_id: ev.id, p_motivo: motivo.trim(), p_usuario: cu?.id || null })
    setG(false)
    if (error || data?.error) { setMsg?.({ tipo:'error', txt: error?.message || data.error }); return }
    onHecho()
  }
  const s0 = ev.asis_snapshot || {}
  const pct = v => v == null ? '—' : `${v}%`
  const fila = (l, a, b) => (
    <tr key={l} style={{borderTop:'1px solid var(--border)'}}>
      <td style={{padding:'6px 8px'}}>{l}</td>
      <td style={{padding:'6px 8px',textAlign:'right',color:'var(--text-muted)'}}>{a}</td>
      <td style={{padding:'6px 8px',textAlign:'right',fontWeight:700}}>{b}</td>
    </tr>
  )
  return (
    <Overlay onCerrar={onCerrar}>
      <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>↻ Recalcular Dimensión 2</div>
      <div style={{fontSize:12,color:'var(--text-muted)',marginBottom:12,lineHeight:1.5}}>
        Usa el mismo período de la evaluación ({fFecha(proc.periodo_desde)} a {fFecha(hasta)}) con el criterio y la asistencia vigentes,
        por ejemplo después de corregir turnos o clasificar ausencias. No cambia las dimensiones 1 y 3. Queda registro de los valores anteriores.
      </div>
      {!proy ? <div style={{padding:16,textAlign:'center',color:'var(--text-muted)'}}>Calculando…</div>
      : proy.error ? <div style={{...avisoS}}>⚠️ {proy.error}</div>
      : (
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,marginBottom:12}}>
          <thead><tr><th style={thS}></th><th style={{...thS,textAlign:'right'}}>Actual</th><th style={{...thS,textAlign:'right'}}>Recalculado</th></tr></thead>
          <tbody>
            {fila('Puntualidad', pct(s0.pctPuntualidad), pct(proy.snap.pctPuntualidad))}
            {fila('Asistencia', pct(s0.pctAsistencia), pct(proy.snap.pctAsistencia))}
            {fila('Nota formal', fmtN(ev.nota_formal), fmtN(proy.formal))}
            {fila('Nota final', fmtN(ev.nota_final), fmtN(proy.final))}
            {fila('Categoría', ev.categoria || '—', proy.cat || '—')}
          </tbody>
        </table>
      )}
      <label style={lblM}>Motivo del recálculo</label>
      <input {...ORTO} value={motivo} onChange={e=>setMotivo(e.target.value)} style={inpFull}/>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:14}}>
        <button onClick={onCerrar} disabled={g} style={btnSec}>Cancelar</button>
        <button onClick={aplicar} disabled={g || !proy || !!proy?.error} style={btnPri}>{g ? 'Recalculando...' : 'Recalcular'}</button>
      </div>
    </Overlay>
  )
}

// ─── Piezas UI ────────────────────────────────────────────────────────────────
function SecTitle({ n, t, extra }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',margin:'0 0 10px 0'}}>
      <div style={{fontSize:14,fontWeight:800}}>
        <span style={{display:'inline-flex',width:22,height:22,borderRadius:100,background:'var(--accent)',color:'white',fontSize:12,alignItems:'center',justifyContent:'center',marginRight:8}}>{n}</span>
        {t}
      </div>
      {extra && <div style={{fontSize:12,fontWeight:700,color:'var(--accent)'}}>{extra}</div>}
    </div>
  )
}
function FilaEscala({ l, opciones, val, onSel }) {
  return (
    <div>
      <label style={lblM}>{l}</label>
      <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
        {opciones.map((o,i)=>(
          <button key={o} onClick={()=>onSel(i+1)}
            style={{flex:'1 1 90px',padding:'6px',borderRadius:8,cursor:'pointer',fontSize:11,
              fontWeight: val===i+1 ? 800 : 500,
              background: val===i+1 ? 'var(--accent)' : 'var(--bg-app)',
              color: val===i+1 ? 'white' : 'var(--text-muted)',
              border:`1px solid ${val===i+1 ? 'var(--accent)' : 'var(--border)'}`}}>{o}</button>
        ))}
      </div>
    </div>
  )
}
function FilaSiNo({ l, val, onSel }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
      <label style={{...lblM,marginBottom:0,textTransform:'none',letterSpacing:0,fontSize:12.5,fontWeight:600,color:'var(--text)'}}>{l}</label>
      <div style={{display:'flex',gap:5}}>
        {['si','no'].map(o=>(
          <button key={o} onClick={()=>onSel(o)}
            style={{padding:'6px 18px',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:val===o?800:500,
              background: val===o ? 'var(--accent)' : 'var(--bg-app)',
              color: val===o ? 'white' : 'var(--text-muted)',
              border:`1px solid ${val===o ? 'var(--accent)' : 'var(--border)'}`}}>{o==='si'?'Sí':'No'}</button>
        ))}
      </div>
    </div>
  )
}
function Metrica({ l, v, sub, c }) {
  return (
    <div style={{background:'var(--bg-app)',borderRadius:10,padding:'9px 12px'}}>
      <div style={{fontSize:10,fontWeight:700,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.04em'}}>{l}</div>
      <div style={{fontSize:19,fontWeight:800,color:c||'var(--text)',marginTop:2}}>{v}</div>
      {sub && <div style={{fontSize:10.5,color:'var(--text-muted)'}}>{sub}</div>}
    </div>
  )
}
function BarraDim({ l, n, vacio }) {
  const num = n != null ? Number(n) : null
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3}}>
        <span style={{color:'var(--text-muted)',fontWeight:600}}>{l}</span>
        <span style={{fontWeight:800}}>{vacio || (num!=null?num.toFixed(2):'—')}</span>
      </div>
      <div style={{height:7,background:'var(--bg-app)',borderRadius:100,overflow:'hidden'}}>
        {num!=null && <div style={{width:`${num/5*100}%`,height:'100%',borderRadius:100,background:categoriaDe(num).c}}/>}
      </div>
    </div>
  )
}
function Overlay({ children, onCerrar, ancho = 520 }) {
  return (
    <div onClick={onCerrar} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-surface)',borderRadius:14,padding:24,width:'100%',maxWidth:ancho,border:'1px solid var(--border)',maxHeight:'88vh',overflowY:'auto'}}>
        {children}
      </div>
    </div>
  )
}

const btnPri   = {padding:'8px 15px',background:'var(--accent)',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}
const btnSec   = {padding:'8px 12px',background:'var(--bg-card)',color:'var(--text)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:500}
const btnGhost = {padding:'8px 14px',background:'transparent',color:'var(--text-muted)',border:'1px solid var(--border)',borderRadius:8,cursor:'pointer',fontSize:13}
const lblM     = {display:'block',fontSize:11,fontWeight:600,color:'var(--text-muted)',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.04em'}
const inpFull  = {padding:'8px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:13,background:'var(--bg-app)',color:'var(--text)',fontFamily:'inherit',width:'100%',boxSizing:'border-box'}
const thS = {padding:'9px 14px',textAlign:'left',fontSize:10.5,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.05em'}
const tdS = {padding:'9px 14px'}
const tabBtn   = {padding:'7px 14px',borderRadius:8,border:'none',background:'transparent',color:'var(--text-muted)',fontSize:12.5,fontWeight:600,cursor:'pointer'}
const tabBtnOn = {background:'var(--bg-app)',color:'var(--text)',boxShadow:'inset 0 0 0 1px var(--border)'}
const secTituloI = {fontSize:12,fontWeight:800,color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}
const badgeEgr = {marginLeft:8,fontSize:9.5,fontWeight:800,padding:'1px 8px',borderRadius:100,background:'#8E8E9320',color:'#8E8E93',verticalAlign:'middle'}
const avisoS   = {fontSize:12,lineHeight:1.5,background:'#FF950010',border:'1px solid #FF950035',borderLeft:'3px solid #FF9500',borderRadius:8,padding:'8px 12px'}
const cardS    = {background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:12,padding:'13px 16px',marginBottom:16}
