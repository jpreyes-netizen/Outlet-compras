// src/procesos/prcSop.jsx
// Generador del documento SOP en formato estándar V2.0 de Outlet de Puertas
// (8 secciones + encabezado de control documental).
// Lo usan por igual el build de semillas y el botón "Generar versión" de la app,
// así el .md que aprueba la dirección y el que vive en la BD son idénticos.

const SCORE = { A: 3, M: 2, B: 1 }
const DIRS = {
  DIR_GENERAL: 'Dirección General', DIR_ADM_FIN: 'Dirección de Administración y Finanzas',
  DIR_COMERCIAL: 'Dirección Comercial', DIR_OPERACIONES: 'Dirección de Operaciones',
  DIR_NEGOCIOS: 'Dirección de Negocios', GESTION_PERSONAS: 'Gestión de Personas'
}

export function sopMarkdown(d) {
  const {
    proceso: p, principios = [], roles = [], transicion = [], fases = [], pasos = [],
    errores = [], kpis = [], dependencias = [], procesosRef = [], comiteNombre = '—', meta = {}
  } = d
  const m = {
    version: '0.1', estado: 'BORRADOR', fecha: new Date().toISOString().slice(0, 10),
    elaborado_por: '—', revisado_por: null, aprobado_por: null, meses_revision: 6, ...meta
  }
  const ord = (a, b) => (a.orden || 0) - (b.orden || 0)
  const fs = [...fases].sort(ord)
  // numeración F.N de cada paso, para citar los destinos de las decisiones
  const numeroPaso = new Map()
  fs.forEach((f, fi) => {
    pasos.filter(x => x.fase_id === f.id).sort(ord).forEach((x, i) => numeroPaso.set(x.id, `${fi + 1}.${i + 1}`))
  })
  const L = []

  L.push(`# SOP-${p.id} — ${p.nombre}`)
  L.push('')
  L.push('| Control documental | |')
  L.push('|---|---|')
  L.push('| Empresa | Outlet de Puertas SpA |')
  L.push(`| Área responsable | ${DIRS[p.direccion_responsable] || p.direccion_responsable || '—'} |`)
  L.push(`| Documento | SOP-${p.id} · versión ${m.version} (${m.estado}) |`)
  L.push(`| Categoría / Onda | ${p.categoria} · ${String(p.onda || '').replace('_', ' ')} |`)
  L.push(`| Prioridad | Impacto ${p.impacto} × Urgencia ${p.urgencia} = score ${(SCORE[p.impacto] || 0) * (SCORE[p.urgencia] || 0)} |`)
  L.push(`| Dueño del proceso | ${p.dueno_cargo || '—'}${p.dueno_persona ? ' — ' + p.dueno_persona : ''}${p.dueno_provisional ? ' *(cargo vacante — dueño provisional)*' : ''} |`)
  L.push(`| Comité que aprueba | ${comiteNombre} |`)
  L.push(`| Fecha de emisión | ${m.fecha} |`)
  L.push(`| Elaborado por | ${m.elaborado_por} |`)
  L.push(`| Revisado por | ${m.revisado_por || '*pendiente*'} |`)
  L.push(`| Aprobado por | ${m.aprobado_por || '*pendiente*'} |`)
  L.push(`| Próxima revisión | ${m.meses_revision} meses desde la aprobación |`)
  L.push('')
  L.push('> **Aviso de vigencia.** Desde la fecha de vigencia de este SOP, todo procedimiento anterior sobre la misma materia queda sin efecto. El incumplimiento se considera falta operativa.')
  L.push('')
  L.push('---')
  L.push('')
  L.push('## 1. Objetivo')
  L.push('')
  L.push(p.objetivo || '*Pendiente de redacción.*')
  L.push('')
  L.push('## 2. Alcance')
  L.push('')
  L.push(p.alcance || '*Pendiente de redacción.*')
  L.push('')
  L.push('## 3. Principios operativos')
  L.push('')
  if (principios.length) [...principios].sort(ord).forEach(x => L.push(`- ${x.texto}`))
  else L.push('*Sin principios registrados.*')
  L.push('')
  L.push('> ### ⚠ REGLA CRÍTICA')
  L.push(`> ${p.regla_critica || '*Pendiente de definición.*'}`)
  L.push('')
  L.push('## 4. Roles y límites')
  L.push('')
  if (roles.length) {
    L.push('| Rol | Función en ESTE proceso | Límite — qué NO puede hacer |')
    L.push('|---|---|---|')
    ;[...roles].sort(ord).forEach(r => L.push(`| **${r.rol}** | ${r.funcion || '—'} | ${r.limite || '—'} |`))
  } else L.push('*Sin roles registrados.*')
  L.push('')
  L.push('## 5. Estado de transición')
  L.push('')
  if (transicion.length) {
    L.push('| Dimensión | Cómo funciona HOY | Cómo debe funcionar |')
    L.push('|---|---|---|')
    ;[...transicion].sort(ord).forEach(t => L.push(`| ${t.dimension} | ${t.hoy || '—'} | ${t.debe_ser || '—'} |`))
  } else L.push('*Sin diagnóstico de transición registrado.*')
  L.push('')
  L.push('## 6. Flujo operativo por fases')
  L.push('')
  if (!fs.length) L.push('*Sin fases registradas.*')
  fs.forEach((f, fi) => {
    const ps = pasos.filter(x => x.fase_id === f.id).sort(ord)
    const es = errores.filter(x => x.fase_id === f.id).sort(ord)
    L.push(`### Fase ${fi + 1} — ${f.nombre}`)
    L.push('')
    const apoyo = (f.responsables_apoyo || []).filter(Boolean)
    L.push(`*${f.descripcion || 'Sin descripción.'}* · Responsable principal: **${f.responsable_principal || '—'}**`
      + (apoyo.length ? ` · Con: ${apoyo.map(a => `**${a}**`).join(', ')}` : ''))
    L.push('')
    L.push('| N° | Acción | Responsable | Participan | Sistema | Documento | Control / tiempo |')
    L.push('|---|---|---|---|---|---|---|')
    ps.forEach((s, si) => {
      const marca = s.es_control_critico ? ' 🔴' : s.es_decision ? ' ◆' : ''
      const dest = id => numeroPaso.has(id) ? ` (paso ${numeroPaso.get(id)})` : ''
      const ramas = s.es_decision
        ? ` <br/>**Sí →** ${s.rama_si || '—'}${s.rama_si_destino ? dest(s.rama_si_destino) : ''}`
          + ` <br/>**No →** ${s.rama_no || '—'}${s.rama_no_destino ? dest(s.rama_no_destino) : ''}`
        : ''
      const parts = (s.participantes || []).filter(Boolean)
      const doc = s.documento ? (s.documento_url ? `[${s.documento}](${s.documento_url})` : s.documento) : '—'
      L.push(`| ${fi + 1}.${si + 1}${marca} | ${s.accion}${ramas} | ${s.responsable || '—'} | ${parts.length ? parts.join(', ') : '—'} | ${s.sistema || '—'} | ${doc} | ${s.control_tiempo || '—'} |`)
    })
    L.push('')
    if (es.length) {
      L.push('**Errores frecuentes de la fase**')
      L.push('')
      L.push('| Error | Consecuencia | Prevención |')
      L.push('|---|---|---|')
      es.forEach(e => L.push(`| ${e.error} | ${e.consecuencia || '—'} | ${e.prevencion || '—'} |`))
      L.push('')
    }
  })
  L.push('🔴 = control crítico · ◆ = punto de decisión')
  L.push('')
  L.push('## 7. Indicadores')
  L.push('')
  if (kpis.length) {
    L.push('| Indicador | Definición operacional | Meta | Frecuencia | Responsable |')
    L.push('|---|---|---|---|---|')
    ;[...kpis].sort(ord).forEach(k => L.push(
      `| ${k.es_kpi_ancla ? '**' + k.indicador + '** ⚓' : k.indicador} | ${k.definicion_operacional || '—'} | ${k.meta || '—'} | ${k.frecuencia || '—'} | ${k.responsable || '—'} |`))
    L.push('')
    L.push('⚓ = indicador ancla del proceso')
  } else L.push('*Sin indicadores registrados.*')
  L.push('')
  L.push('## 8. Relación con otros procesos')
  L.push('')
  if (dependencias.length) {
    L.push('| Proceso | Nombre | Tipo de relación |')
    L.push('|---|---|---|')
    dependencias.forEach(dep => {
      const o = procesosRef.find(x => x.id === dep.depende_de_id)
      L.push(`| ${dep.depende_de_id} | ${o ? o.nombre : '—'} | ${dep.tipo} |`)
    })
  } else L.push('Sin dependencias registradas.')
  L.push('')
  L.push('---')
  L.push('')
  L.push(`*Documento en estado ${m.estado}. Generado desde el módulo Procesos del ERP Outlet el ${m.fecha}.`
    + `${m.estado === 'VIGENTE' ? '' : ' No tiene validez operativa hasta su aprobación firmada en el comité correspondiente.'}*`)
  return L.join('\n')
}

/** Hash estable del contenido, para detectar si una versión firmada fue alterada. */
export function hashContenido(txt) {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  const s = String(txt || '')
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0
    h2 = Math.imul(h2 + c, 2654435761) >>> 0
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).toUpperCase()
}

/** Siguiente número de versión: 0.1 → 0.2 … y 0.9 → 1.0 al aprobar. */
export function siguienteVersion(actual, mayor) {
  const [a, b] = String(actual || '0.0').split('.').map(x => parseInt(x, 10) || 0)
  return mayor ? `${a + 1}.0` : `${a}.${b + 1}`
}
