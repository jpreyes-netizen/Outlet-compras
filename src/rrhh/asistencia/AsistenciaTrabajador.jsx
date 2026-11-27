// src/rrhh/asistencia/AsistenciaTrabajador.jsx
// ═══════════════════════════════════════════════════════════════════════════
// ASISTENCIA DEL TRABAJADOR, DÍA A DÍA (27-11-2026)
// Una sola vista gráfica de la asistencia de una persona: estado actual de sus
// validaciones, indicadores del período y un calendario donde cada día se lee
// de un vistazo. Se usa en la ficha de Asistencia (jefaturas) y en el perfil
// unificado del Maestro de dotación (Gestión de Personas): misma información
// en los dos lugares.
// No calcula reglas: cada día viene clasificado por fn_asis_dias (el criterio
// del Maestro y de la Evaluación de Desempeño: tolerancia del art. 27, errores
// de marcaje validados) y las horas extra por v_asis_hhee_dia (la fuente única
// que también leen la pre-nómina y las vistas de costo).
// v2 (27-11-2026): el estado actual muestra TODO lo pendiente de la persona en
// la ventana única (lib/pendientes: tres últimos períodos), no solo el período
// a la vista; cada día pendiente es un acceso directo al calendario. La vista
// abre en el período de hace una semana (igual que la bandeja), para que justo
// después del corte del 25 se vea el período que se está cerrando.
// v3 (27-11-2026): sección "Decisiones de horas extra" (autorizadas, rechazadas y por
// decidir, con su historial) y reapertura con motivo obligatorio vía
// fn_asis_reabrir_decision (permisos, firma y bloqueo de períodos cerrados en la base).
// El calendario marca ✓ lo autorizado, ✗ lo rechazado y ● lo por decidir.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { supabase } from '../../supabase'
import { hoyCL, pendientesDesde, periodoAbiertoDesde } from './lib/pendientes'

const NUM = { fontVariantNumeric: 'tabular-nums' }
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIA_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const p2 = n => String(n).padStart(2, '0')
const utc = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const iso = d => d.toISOString().slice(0, 10)
const mas = (i, n) => { const d = utc(i); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
const fFecha = i => { const [y, m, d] = String(i).slice(0, 10).split('-'); return `${d}-${m}-${y}` }
const fMin = m => { m = Math.round(m || 0); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m` }
const hora = ts => ts ? String(ts).slice(11, 16) : null
// Minutos desde las 00:00 del día de la jornada (una salida pasada la medianoche suma 24 h)
const minDia = (ts, f) => { if (!ts) return null; const s = String(ts); return (s.slice(0, 10) > f ? 1440 : 0) + (+s.slice(11, 13)) * 60 + (+s.slice(14, 16)) }

// Período de pago 26–25 (el de las horas extra) o mes calendario (el de los días)
const periodoDe = (modo, f) => { const [y, m, d] = f.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1 + (modo === 'pago' && d >= 26 ? 1 : 0), 1)); return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}` }
const rangoDe = (modo, p) => {
  const [y, m] = p.split('-').map(Number)
  return modo === 'pago' ? { desde: iso(new Date(Date.UTC(y, m - 2, 26))), hasta: `${p}-25` } : { desde: `${p}-01`, hasta: iso(new Date(Date.UTC(y, m, 0))) }
}
const moverP = (p, n) => { const [y, m] = p.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1 + n, 1)); return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}` }
const etiqueta = (modo, p) => {
  const [y, m] = p.split('-').map(Number)
  if (modo === 'mes') return `${MES_L[m - 1]} ${y}`
  return `26 ${MES[(m + 10) % 12]} – 25 ${MES[m - 1]} ${y}`
}

// Cómo se ve cada tipo de día. El color dice el hecho; el texto, el detalle.
const TIPOS = {
  ok:          { l: 'A tiempo',                bg: '#E7F6EC', fg: '#1E7A44', bd: '#BFE5CC' },
  atraso:      { l: 'Atraso',                  bg: '#FFF1DE', fg: '#9A3412', bd: '#F5D3A4' },
  incompleta:  { l: 'Marca incompleta', c: 'Incompleta', bg: '#FFFBEB', fg: '#92600A', bd: '#E9C46A', dash: true },
  falta:       { l: 'Falta',                   bg: '#FDECEC', fg: '#B42318', bd: '#F3B8B2' },
  porclasif:   { l: 'Ausencia sin clasificar', c: 'Sin clasificar', bg: '#FFFFFF', fg: '#B42318', bd: '#B42318', fuerte: true },
  licencia:    { l: 'Licencia médica', c: 'Licencia', bg: '#E8F1FB', fg: '#175CD3', bd: '#BBD3F5' },
  vacaciones:  { l: 'Vacaciones',              bg: '#E3F6F3', fg: '#0E7C72', bd: '#B3E2DB' },
  permiso:     { l: 'Permiso',                 bg: '#F1ECFB', fg: '#6941C6', bd: '#D5C8F3' },
  justificado: { l: 'Justificado',             bg: '#EEF0F3', fg: '#475467', bd: '#D0D5DD' },
  fuera:       { l: 'Trabajó fuera de turno', c: 'Fuera de turno', bg: '#EDE7FB', fg: '#5B3CC4', bd: '#C9BBF0' },
  libre:       { l: 'Sin turno',               bg: 'transparent', fg: '#98A2B3', bd: 'var(--border)' },
  futuro:      { l: 'Por venir',               bg: 'transparent', fg: '#C0C5CE', bd: 'var(--border)', dash: true },
}
function tipoDe(d, hoy) {
  if (!d || d.fecha > hoy) return 'futuro'
  switch (d.clase) {
    case 'trabajado': return (!d.puntual && d.min_atraso > 0) ? 'atraso' : (d.estado_dia === 'incompleta' || d.atipico === 'sin_entrada' || d.atipico === 'marca_unica') ? 'incompleta' : 'ok'
    case 'falta': return 'falta'
    case 'sin_clasificar': case 'sin_registro': return 'porclasif'
    case 'licencia': return 'licencia'
    case 'vacaciones': return 'vacaciones'
    case 'permiso_con_goce': case 'permiso_sin_goce': return 'permiso'
    case 'otro_justificado': return 'justificado'
    case 'fuera_turno': return 'fuera'
    default: return 'libre'
  }
}
// Si la función de clasificación no responde, se arma lo esencial desde las jornadas
function diasDesdeJornadas(jor, aus) {
  return jor.map(j => {
    const a = aus[String(j.fecha).slice(0, 10)], nov = j.novedad_tipo || a?.clasificacion
    const clase = j.estado_dia === 'sin_turno' ? ((j.n_marcas_dia || 0) > 0 ? 'fuera_turno' : 'sin_turno')
      : j.estado_dia === 'sin_marcas' ? (nov === 'licencia_medica' ? 'licencia' : nov === 'vacaciones' ? 'vacaciones' : /permiso/.test(nov || '') ? 'permiso_con_goce'
        : nov === 'falta_injustificada' ? 'falta' : nov ? 'otro_justificado' : 'sin_clasificar') : 'trabajado'
    return { fecha: String(j.fecha).slice(0, 10), clase, con_turno: j.estado_dia !== 'sin_turno', es_feriado: !!j.es_feriado, base_punt: clase === 'trabajado',
      puntual: j.estado_dia !== 'atraso', min_atraso: j.min_atraso_contable || 0, estado_dia: j.estado_dia, turno: j.workshift_name,
      entrada_esperada: j.entrada_esperada, salida_esperada: j.salida_esperada, entrada_real: j.entrada_real, salida_real: j.salida_real, n_marcas: j.n_marcas_dia }
  })
}

export function AsistenciaTrabajador({ cod, onIr, onAbrirPerfil }) {
  const hoy = hoyCL()
  const [modo, setModo] = useState('pago')
  const perDef = k => periodoDe(k, k === 'pago' ? mas(hoy, -7) : hoy)
  const [per, setPer] = useState(() => perDef('pago'))
  const [pend, setPend] = useState(null)       // pendientes vigentes (todos los períodos de la ventana)
  const [irA, setIrA] = useState(null)         // día al que saltar cuando cargue su período
  const [dat, setDat] = useState(null)
  const [sel, setSel] = useState(null)
  const [carg, setCarg] = useState(true)
  const [err, setErr] = useState(null)
  const [esGestor, setEsGestor] = useState(false)
  const [puedeDec, setPuedeDec] = useState(false)   // puede decidir sobre esta persona (la base lo vuelve a exigir)
  const [reab, setReab] = useState(null)             // decisión a reabrir
  const [aviso, setAviso] = useState(null)
  const [filtroDec, setFiltroDec] = useState('todas')
  useEffect(() => {
    supabase.rpc('fn_asis_puede_decidir', { p_cod: cod }).then(x => setPuedeDec(x?.data === true), () => setPuedeDec(false))
  }, [cod])
  const r = useMemo(() => rangoDe(modo, per), [modo, per])

  useEffect(() => {
    if (!onAbrirPerfil) return
    supabase.rpc('fn_rrhh_es_gestor').then(x => setEsGestor(x?.data === true), () => setEsGestor(false))
  }, [onAbrirPerfil])

  // Estado actual: todo lo que sigue por decidir de la persona, en cualquier período de la ventana
  const cargarPend = useCallback(async () => {
    const desde = pendientesDesde(hoy)
    const [hp, fd] = await Promise.all([
      supabase.from('v_asis_hhee_dia').select('fecha,tipo_dia,es_feriado,min_pend_salida,min_pend_entrada,min_pend_ft,ft_decision,ft_clasificacion,min_ft_trab')
        .eq('cod_contaline', cod).eq('dia_pendiente', true).gte('fecha', desde).lte('fecha', hoy),
      supabase.rpc('fn_asis_dias', { p_cods: [cod], p_desde: desde, p_hasta: hoy, p_incluir_inactivos: true }),
    ])
    const it = { sal: [], ent: [], ft: [], aus: [] }
    for (const h of hp.data || []) {
      const f = String(h.fecha).slice(0, 10)
      if (h.min_pend_salida > 0) it.sal.push({ f, m: h.min_pend_salida })
      if (h.min_pend_entrada > 0) it.ent.push({ f, m: h.min_pend_entrada })
      if (h.tipo_dia === 'fuera_turno' && !h.ft_decision && !h.es_feriado) it.ft.push({ f, m: h.min_pend_ft || h.min_ft_trab || 0 })
    }
    if (!fd.error) for (const d of fd.data || []) { const f = String(d.fecha).slice(0, 10); if ((d.clase === 'sin_clasificar' || d.clase === 'sin_registro') && f < hoy) it.aus.push({ f, m: 0 }) }
    for (const k of Object.keys(it)) it[k].sort((a, b) => a.f.localeCompare(b.f))
    setPend({ desde, abierto: periodoAbiertoDesde(hoy), it, error: hp.error ? (hp.error.message || String(hp.error)) : null })
  }, [cod, hoy])
  useEffect(() => { cargarPend() }, [cargarPend])
  // Saltar al día elegido en el estado actual: se cambia de período y se abre el día al cargar
  const saltar = f => { setPer(periodoDe(modo, f)); setIrA(f) }

  const cargar = useCallback(async () => {
    setCarg(true); setErr(null); setSel(null)
    try {
      const [fd, he, jo, au, va, fdec] = await Promise.all([
        supabase.rpc('fn_asis_dias', { p_cods: [cod], p_desde: r.desde, p_hasta: r.hasta, p_incluir_inactivos: true }),
        supabase.from('v_asis_hhee_dia').select('*').eq('cod_contaline', cod).gte('fecha', r.desde).lte('fecha', r.hasta),
        supabase.from('v_asis_jornadas')
          .select('fecha,estado_dia,workshift_name,schedule_name,entrada_esperada,salida_esperada,entrada_real,salida_real,inicio_colacion_real,fin_colacion_real,' +
            'n_marcas_dia,min_atraso_contable,min_salida_anticipada_contable,min_trabajados_efectivos,novedad_tipo,es_feriado,feriado_nombre,turno_corregido')
          .eq('cod_contaline', cod).gte('fecha', r.desde).lte('fecha', r.hasta),
        supabase.from('asis_ausencias').select('fecha,clasificacion,justificacion,gestionado_por').eq('cod_contaline', cod).eq('activo', true).gte('fecha', r.desde).lte('fecha', r.hasta),
        // Todas las decisiones del período, vigentes y anuladas: son el historial de la bitácora
        supabase.from('asis_hhee_validaciones').select('id,fecha,tipo,decision,min_extra_snapshot,justificacion,validado_por,validado_at,activo,anulado_por,anulado_at,anulado_motivo')
          .eq('cod_contaline', cod).gte('fecha', r.desde).lte('fecha', r.hasta),
        supabase.from('asis_fuera_turno_decisiones').select('id,fecha,decision,minutos_autorizados,min_trabajados_snapshot,motivo,decidido_por,created_at,activo,anulado_por,anulado_at,anulado_motivo')
          .eq('cod_contaline', cod).gte('fecha', r.desde).lte('fecha', r.hasta),
      ])
      if (he.error) throw he.error
      if (jo.error) throw jo.error
      const porF = (rows, k = 'fecha') => Object.fromEntries((rows || []).map(x => [String(x[k]).slice(0, 10), x]))
      const aus = porF(au.data), jor = porF(jo.data), hex = porF(he.data)
      const base = fd.error || !Array.isArray(fd.data) ? diasDesdeJornadas(jo.data || [], aus) : fd.data.map(x => ({ ...x, fecha: String(x.fecha).slice(0, 10) }))
      const ids = [...new Set([...(he.data || []).flatMap(x => [x.salida_validado_por, x.entrada_validado_por]), ...(au.data || []).map(x => x.gestionado_por), ...(va.data || []).flatMap(x => [x.validado_por, x.anulado_por])].filter(Boolean))]
      let noms = {}
      if (ids.length) { const u = await supabase.from('usuarios').select('id,nombre').in('id', ids); noms = Object.fromEntries((u.data || []).map(x => [x.id, x.nombre])) }
      setDat({ dias: porF(base), hex, jor, aus, noms, simplificado: !!fd.error, val: va.data || [], ftd: fdec.data || [],
        errDec: va.error || fdec.error ? (va.error || fdec.error).message || 'error' : null })
    } catch (e) { setErr(e?.message || String(e)); setDat(null) }
    finally { setCarg(false) }
  }, [cod, r.desde, r.hasta])
  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { if (irA && dat?.dias?.[irA]) { setSel(irA); setIrA(null) } }, [dat, irA])

  // ── Lectura del período: indicadores y lo que falta resolver ──
  const v = useMemo(() => {
    if (!dat) return null
    const ds = Object.values(dat.dias).filter(d => d.fecha <= hoy)
    const t = k => ds.filter(d => tipoDe(d, hoy) === k)
    const trab = ds.filter(d => d.clase === 'trabajado'), base = ds.filter(d => d.base_punt)
    const atr = t('atraso'), hs = Object.values(dat.hex).filter(h => String(h.fecha).slice(0, 10) <= hoy)
    const s = k => hs.reduce((a, h) => a + (h[k] || 0), 0), n = f => hs.filter(f).length
    const jornadas = trab.length + t('falta').length + t('porclasif').length
    return { trab: trab.length, jornadas, pctAsis: jornadas ? Math.round(trab.length / jornadas * 100) : null,
      puntuales: base.filter(d => d.puntual).length, basePunt: base.length, pctPunt: base.length ? Math.round(base.filter(d => d.puntual).length / base.length * 100) : null,
      atrasos: atr.length, minAtraso: atr.reduce((a, d) => a + (d.min_atraso || 0), 0), faltas: t('falta').length + t('porclasif').length,
      justif: t('licencia').length + t('vacaciones').length + t('permiso').length + t('justificado').length, incompletas: t('incompleta').length,
      he: s('min_autorizados'), h15: s('min_tramo_150'), h18: s('min_tramo_exceso'), heSal: s('min_salida_aut'), heEnt: s('min_entrada_aut'), heFt: s('min_ft_aut'),
      hePend: s('min_pendientes'), heRech: s('min_rechazados'), usados: new Set(Object.values(dat.dias).map(d => tipoDe(d, hoy))) }
  }, [dat, hoy])

  const decs = useMemo(() => dat ? armarDecisiones(dat) : null, [dat])
  const recargar = txt => { setReab(null); setAviso(txt); cargar(); cargarPend() }

  // Rejilla lunes a domingo que cubre el período completo
  const semanas = useMemo(() => {
    const ini = utc(r.desde), off = (ini.getUTCDay() + 6) % 7, out = []
    let f = mas(r.desde, -off)
    while (f <= r.hasta) { out.push(Array.from({ length: 7 }, (_, i) => mas(f, i))); f = mas(f, 7) }
    return out
  }, [r.desde, r.hasta])

  const cPct = p => p == null ? 'var(--text-muted)' : p >= 95 ? '#1E7A44' : p >= 85 ? '#B25E09' : '#B42318'
  const enCurso = r.hasta >= hoy && r.desde <= hoy

  return (
    <div style={{ fontSize: 13 }}>
      {/* Período */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {[['pago', 'Período de pago 26–25'], ['mes', 'Mes calendario']].map(([k, l]) => (
            <button key={k} onClick={() => { setModo(k); setPer(perDef(k)) }}
              style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: modo === k ? '#16213E' : 'var(--bg-surface)', color: modo === k ? '#fff' : 'var(--text-muted)' }}>{l}</button>
          ))}
        </div>
        <button onClick={() => setPer(p => moverP(p, -1))} style={nav} aria-label='Período anterior'>‹</button>
        <strong style={{ minWidth: 150, textAlign: 'center', textTransform: modo === 'mes' ? 'capitalize' : 'none' }}>{etiqueta(modo, per)}</strong>
        <button onClick={() => setPer(p => moverP(p, 1))} disabled={per >= periodoDe(modo, hoy)} style={{ ...nav, opacity: per >= periodoDe(modo, hoy) ? .35 : 1 }} aria-label='Período siguiente'>›</button>
        {enCurso && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>en curso · hasta hoy</span>}
        {onAbrirPerfil && esGestor && <button onClick={onAbrirPerfil} style={{ ...nav, marginLeft: 'auto', width: 'auto', padding: '6px 12px', fontSize: 12, fontWeight: 600 }}>Ver perfil completo →</button>}
      </div>

      {err && <div style={{ ...caja, borderColor: '#F3C5C0', background: '#FEF3F2', color: '#B42318', marginBottom: 12 }}>No se pudo leer la asistencia: {err}</div>}
      {carg && !dat && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando asistencia…</div>}

      {dat && v && (<>
        {/* Estado actual: todo lo pendiente de la persona (ventana única), con acceso a cada día */}
        {pend && <EstadoActual pend={pend} onIr={onIr} onDia={saltar} />}

        {/* Indicadores */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(122px, 1fr))', gap: 8, marginBottom: 12 }}>
          <Ind l='Días trabajados' v={`${v.trab} de ${v.jornadas}`} s={v.pctAsis == null ? 'sin jornadas' : `${v.pctAsis}% de asistencia`} c={cPct(v.pctAsis)} />
          <Ind l='Puntualidad' v={v.pctPunt == null ? 's/d' : `${v.pctPunt}%`} s={`${v.puntuales} de ${v.basePunt} días a tiempo`} c={cPct(v.pctPunt)} />
          <Ind l='Atrasos' v={v.atrasos} s={v.atrasos ? `${fMin(v.minAtraso)} en total` : 'ninguno'} c={v.atrasos ? '#9A3412' : '#1E7A44'} />
          <Ind l='Ausencias' v={v.faltas} s={v.justif ? `+ ${v.justif} ${v.justif === 1 ? 'día justificado' : 'días justificados'}` : 'sin días justificados'} c={v.faltas ? '#B42318' : '#1E7A44'} />
          <Ind l='HE autorizadas' v={fMin(v.he)} s={v.he ? `${fMin(v.h15)} al 1,5${v.h18 ? ` · ${fMin(v.h18)} sobre 2 h` : ''}` : 'sin horas extra'} c='#16213E' />
          <Ind l='HE por decidir' v={v.hePend ? fMin(v.hePend) : '—'} s={v.hePend ? 'no se pagan hasta decidir' : 'nada pendiente'} c={v.hePend ? '#9A3412' : 'var(--text-muted)'} />
        </div>

        {/* De dónde vienen las horas extra autorizadas */}
        {v.he > 0 && (
          <div style={{ ...caja, marginBottom: 12, padding: '9px 14px' }}>
            <div style={{ display: 'flex', height: 10, borderRadius: 100, overflow: 'hidden', background: 'var(--border)' }}>
              {ORIG.map(o => v[o.k] > 0 ? <span key={o.k} title={`${o.l}: ${fMin(v[o.k])}`} style={{ width: `${v[o.k] / v.he * 100}%`, background: o.c }} /> : null)}
            </div>
            <div style={{ display: 'flex', gap: '2px 14px', flexWrap: 'wrap', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5 }}>
              {ORIG.map(o => <span key={o.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><i style={{ width: 9, height: 9, borderRadius: 2, background: o.c, display: 'inline-block' }} />{o.l} {fMin(v[o.k])}</span>)}
              {v.heRech > 0 && <span>· {fMin(v.heRech)} rechazadas</span>}
            </div>
          </div>
        )}

        {/* Calendario */}
        <div style={{ ...caja, padding: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 5 }}>
            {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => <div key={d} style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', padding: '0 4px 2px' }}>{d}</div>)}
            {semanas.flat().map(f => {
              const fuera = f < r.desde || f > r.hasta
              if (fuera) return <div key={f} />
              const d = dat.dias[f], h = dat.hex[f], k = tipoDe(d, hoy), T = TIPOS[k], activo = sel === f
              const [, mm, dd] = f.split('-')
              const txt = k === 'ok' ? (hora(d.entrada_real) || '') : k === 'atraso' ? `+${fMin(d.min_atraso)}` : k === 'libre' || k === 'futuro' ? '' : (T.c || T.l)
              return (
                <button key={f} onClick={() => setSel(activo ? null : f)} disabled={k === 'futuro'}
                  title={`${fFecha(f)} · ${T.l}${d?.es_feriado ? ' · feriado' : ''}`}
                  style={{ position: 'relative', minHeight: 58, padding: '4px 6px', textAlign: 'left', cursor: k === 'futuro' ? 'default' : 'pointer', background: T.bg, color: T.fg,
                    border: `${T.fuerte ? 2 : 1}px ${T.dash ? 'dashed' : 'solid'} ${activo ? '#16213E' : T.bd}`, borderRadius: 7,
                    boxShadow: activo ? '0 0 0 2px #16213E' : 'none', font: 'inherit' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ ...NUM, fontSize: 12.5, fontWeight: 700, color: k === 'libre' || k === 'futuro' ? T.fg : 'var(--text)' }}>{+dd}{dd === '01' || f === r.desde ? <span style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--text-muted)' }}> {MES[+mm - 1]}</span> : null}</span>
                    {(d?.es_feriado || f === hoy) && <span style={{ fontSize: 9, fontWeight: 800, color: f === hoy ? '#16213E' : '#6E6E73' }}>{f === hoy ? 'HOY' : 'FERIADO'}</span>}
                  </div>
                  <div style={{ ...NUM, fontSize: 11, fontWeight: 600, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{txt}</div>
                  {h && (() => {
                    const rT = rechazadoDia(h)
                    if (!(h.min_autorizados > 0 || h.dia_pendiente || rT > 0)) return null
                    return (
                      <div style={{ ...NUM, fontSize: 10, fontWeight: 700, marginTop: 2, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                        {h.dia_pendiente && <div style={{ color: '#9A3412' }}>● por decidir</div>}
                        {h.min_autorizados > 0 && <div style={{ color: '#1E7A44' }}>✓ +{fMin(h.min_autorizados)}</div>}
                        {rT > 0 && <div style={{ color: '#B42318' }}>✗ {fMin(rT)}</div>}
                      </div>
                    )
                  })()}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: '4px 12px', flexWrap: 'wrap', marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
            {Object.entries(TIPOS).filter(([k]) => v.usados.has(k) && k !== 'futuro').map(([k, T]) => (
              <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <i style={{ width: 11, height: 11, borderRadius: 3, background: T.bg, border: `${T.fuerte ? 2 : 1}px ${T.dash ? 'dashed' : 'solid'} ${T.bd}`, display: 'inline-block' }} />{T.l}</span>
            ))}
            <span style={{ marginLeft: 'auto' }}>Toca un día para ver el detalle</span>
          </div>
          {dat.simplificado && <div style={{ fontSize: 11, color: '#B25E09', marginTop: 6 }}>Clasificación simplificada: no se pudo leer el criterio completo de asistencia.</div>}
        </div>

        {sel && <DetalleDia f={sel} d={dat.dias[sel]} h={dat.hex[sel]} j={dat.jor[sel]} a={dat.aus[sel]} noms={dat.noms} tipo={tipoDe(dat.dias[sel], hoy)}
          gr={decs?.porDia[sel] || {}} puede={puedeDec} onReabrir={setReab} />}

        {aviso && <div style={{ ...caja, marginTop: 10, borderColor: '#BFE5CC', background: '#F3FBF6', color: '#1E7A44', fontWeight: 600, display: 'flex', gap: 10 }}>
          <span style={{ flex: 1 }}>{aviso}</span><button onClick={() => setAviso(null)} style={lnk}>Cerrar</button></div>}
        {decs && <SeccionDecisiones decs={decs} filtro={filtroDec} setFiltro={setFiltroDec} puede={puedeDec} onReabrir={setReab}
          onDia={f => setSel(f)} errDec={dat.errDec} />}
        {reab && <ModalReabrir g={reab} onCerrar={() => setReab(null)} onHecho={recargar} />}
      </>)}
    </div>
  )
}

const GRUPOS_PEND = [
  { k: 'sal', l: ['hora extra de salida por decidir', 'horas extra de salida por decidir'], donde: 'Por validar › Horas extra', sub: 'hhee' },
  { k: 'ent', l: ['llegada anticipada por decidir', 'llegadas anticipadas por decidir'], donde: 'Por validar › Llegada anticipada', sub: 'hhee' },
  { k: 'ft', l: ['día trabajado fuera de turno por decidir', 'días trabajados fuera de turno por decidir'], donde: 'Trabajo fuera de turno', sub: 'fuera_turno' },
  { k: 'aus', l: ['ausencia sin clasificar', 'ausencias sin clasificar'], donde: 'Por validar › Ausencias', sub: 'hhee' },
]
// Qué falta resolver de la persona, en cualquier período vigente, y dónde se decide
function EstadoActual({ pend, onIr, onDia }) {
  const gs = GRUPOS_PEND.map(g => ({ ...g, xs: pend.it[g.k] || [] })).filter(g => g.xs.length)
  const total = gs.reduce((a, g) => a + g.xs.length, 0)
  const pagados = gs.some(g => g.xs.some(x => x.f < pend.abierto))
  const fC = f => { const [, m, d] = f.split('-'); return `${+d} ${MES[+m - 1]}` }
  return (
    <div style={{ ...caja, marginBottom: 12, borderLeft: `4px solid ${total ? '#B25E09' : '#1E7A44'}`, background: total ? '#FFFAF2' : '#F3FBF6' }}>
      {total === 0
        ? <span style={{ fontWeight: 650, color: '#1E7A44' }}>Al día: nada por decidir desde el {fFecha(pend.desde)}.</span>
        : (<>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: '#9A3412' }}>Falta resolver {total} {total === 1 ? 'día' : 'días'} de esta persona</span>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>pendientes vigentes desde el {fFecha(pend.desde)} · tres últimos períodos de pago</span>
            </div>
            <div style={{ display: 'grid', gap: 7 }}>
              {gs.map(g => {
                const m = g.xs.reduce((a, x) => a + (x.m || 0), 0)
                return (
                  <div key={g.k}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong style={{ ...NUM, minWidth: 18, textAlign: 'right' }}>{g.xs.length}</strong>
                      <span>{g.l[g.xs.length === 1 ? 0 : 1]}{m ? <span style={{ color: 'var(--text-muted)' }}> · {fMin(m)}</span> : null}</span>
                      {onIr ? <button onClick={() => onIr(g.sub)} style={lnk}>Ir a {g.donde} →</button>
                            : <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>se decide en {g.donde}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', paddingLeft: 26, marginTop: 4 }}>
                      {g.xs.map(x => {
                        const pagado = x.f < pend.abierto
                        return (
                          <button key={x.f} onClick={() => onDia(x.f)}
                            title={`${fFecha(x.f)}${x.m ? ` · ${fMin(x.m)}` : ''}${pagado ? ' · período ya pagado: si se autoriza, se paga como ajuste en la liquidación siguiente' : ''} · ver en el calendario`}
                            style={{ ...NUM, padding: '2px 8px', borderRadius: 100, fontSize: 11.5, fontWeight: 650, cursor: 'pointer', minHeight: 0, lineHeight: 1.5,
                              background: pagado ? '#FFF' : '#FFF1DE', color: '#9A3412', border: `1px ${pagado ? 'dashed' : 'solid'} ${pagado ? '#B25E09' : '#F5D3A4'}` }}>
                            {fC(x.f)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            {pagados && <div style={{ fontSize: 11.5, color: '#9A3412', marginTop: 7 }}>
              Los días con borde punteado son de un período ya pagado: si se autorizan, se pagan como ajuste en la liquidación siguiente.</div>}
          </>)}
      {pend.error && <div style={{ fontSize: 11.5, color: '#B42318', marginTop: 5 }}>No se pudo leer todo lo pendiente: {pend.error}</div>}
    </div>
  )
}

// ─── Decisiones de horas extra: vigentes, por decidir e historial ─────────────
const ETQ = {
  aut:    { s: '✓', c: '#1E7A44', bg: '#E7F6EC', bd: '#BFE5CC' },
  rech:   { s: '✗', c: '#B42318', bg: '#FDECEC', bd: '#F3B8B2' },
  normal: { s: '=', c: '#475467', bg: '#EEF0F3', bd: '#D0D5DD' },
  pend:   { s: '●', c: '#9A3412', bg: '#FFF1DE', bd: '#F5D3A4' },
}
const TIPO_D = { sal: { l: 'Después del turno', c: '#16213E' }, ent: { l: 'Llegada anticipada', c: '#B25E09' }, ft: { l: 'Fuera de turno', c: '#6941C6' } }
// Fecha y hora en Chile de un instante guardado con zona (validado_at, anulado_at)
const fDT = ts => {
  if (!ts) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ts)).map(x => [x.type, x.value]))
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}`
}
// Minutos rechazados del día: salida rechazada, llegada anticipada no requerida y fuera de turno sin pago
const rechazadoDia = h => (h.min_rech_salida || 0) + (h.entrada_decision === 'rechazada' ? (h.min_entrada_det || 0) : 0) + (h.min_rech_ft || 0)
const textoHist = e => `Antes: ${e.etq}${e.min ? ` (${fMin(e.min)})` : ''} · ${e.por || '—'}${e.at ? ` el ${fDT(e.at)}` : ''}`
  + ` → reabierta por ${e.anPor || '—'}${e.anAt ? ` el ${fDT(e.anAt)}` : ''}${e.anMot ? `: “${e.anMot}”` : ' (sin motivo registrado)'}`

// Una fila por día y tipo: la decisión vigente (o lo pendiente) y su historial de reaperturas
function armarDecisiones(dat) {
  const nom = id => id ? (dat.noms[id] || id) : null
  const m = new Map()
  const g = (f, t) => { const k = `${f}|${t}`; if (!m.has(k)) m.set(k, { key: k, fecha: f, tipo: t, vigente: null, hist: [], pend: null }); return m.get(k) }
  for (const v of dat.val || []) {
    const f = String(v.fecha).slice(0, 10), t = v.tipo === 'entrada' ? 'ent' : 'sal', aut = v.decision === 'autorizada'
    const e = { origen: 'validacion', id: v.id, est: aut ? 'aut' : 'rech', etq: aut ? 'Autorizada' : t === 'ent' ? 'No requerida' : 'Rechazada',
      min: v.min_extra_snapshot || 0, por: nom(v.validado_por), at: v.validado_at, just: v.justificacion,
      anPor: nom(v.anulado_por), anAt: v.anulado_at, anMot: v.anulado_motivo }
    if (v.activo) g(f, t).vigente = e; else g(f, t).hist.push(e)
  }
  for (const d of dat.ftd || []) {
    const f = String(d.fecha).slice(0, 10), he = d.decision === 'horas_extra'
    const e = { origen: 'fuera_turno', id: d.id, est: he ? 'aut' : d.decision === 'era_su_turno' ? 'normal' : 'rech',
      etq: he ? 'Pagada como hora extra' : d.decision === 'era_su_turno' ? 'Jornada normal' : 'No corresponde',
      min: he ? d.minutos_autorizados || 0 : d.min_trabajados_snapshot || 0, minTrab: d.min_trabajados_snapshot,
      por: d.decidido_por, at: d.created_at, just: d.motivo, anPor: d.anulado_por, anAt: d.anulado_at, anMot: d.anulado_motivo }
    if (d.activo) g(f, 'ft').vigente = e; else g(f, 'ft').hist.push(e)
  }
  for (const h of Object.values(dat.hex || {})) {
    const f = String(h.fecha).slice(0, 10)
    if (h.min_pend_salida > 0) g(f, 'sal').pend = h.min_pend_salida
    if (h.min_pend_entrada > 0) g(f, 'ent').pend = h.min_pend_entrada
    if (h.tipo_dia === 'fuera_turno' && !h.ft_decision && !h.es_feriado) g(f, 'ft').pend = h.min_ft_trab || h.min_pend_ft || 0
  }
  const filas = []
  for (const x of m.values()) {
    const h = dat.hex[x.fecha]
    x.det = x.tipo === 'sal' ? h?.min_salida_det : x.tipo === 'ent' ? h?.min_entrada_det : (h?.min_ft_trab ?? x.vigente?.minTrab)
    x.feriado = !!h?.es_feriado
    x.paga = x.tipo === 'sal' ? h?.min_salida_aut || 0 : x.tipo === 'ent' ? h?.min_entrada_aut || 0 : h?.min_ft_aut || 0
    if (x.vigente) x.pend = null
    x.est = x.vigente ? x.vigente.est : x.pend != null ? 'pend' : null
    x.hist.sort((a, b) => String(a.anAt || a.at).localeCompare(String(b.anAt || b.at)))
    if (x.est || x.hist.length) filas.push(x)
  }
  filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || 'salentft'.indexOf(a.tipo) - 'salentft'.indexOf(b.tipo))
  const porDia = {}; for (const x of filas) (porDia[x.fecha] ||= {})[x.tipo] = x
  const de = est => filas.filter(x => x.est === est)
  return { filas, porDia, aut: de('aut'), rech: de('rech'), normal: de('normal'), pend: de('pend'), reab: filas.filter(x => x.hist.length) }
}

const thD = { textAlign: 'left', padding: '7px 10px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }
const tdD = { padding: '8px 10px', verticalAlign: 'top' }
function SeccionDecisiones({ decs, filtro, setFiltro, puede, onReabrir, onDia, errDec }) {
  const sm = xs => xs.reduce((a, x) => a + (x.est === 'aut' ? (x.feriado ? 0 : x.paga || 0) : x.est === 'pend' ? (x.pend || 0) : (x.vigente?.min || x.det || 0)), 0)
  const chips = [
    ['todas', 'Todas', decs.filas.length, 0, '#16213E'],
    ['aut', '✓ Autorizadas', decs.aut.length, sm(decs.aut), '#1E7A44'],
    ['rech', '✗ Rechazadas o no requeridas', decs.rech.length, sm(decs.rech), '#B42318'],
    ['pend', '● Por decidir', decs.pend.length, sm(decs.pend), '#9A3412'],
    ...(decs.normal.length ? [['normal', '= Jornada normal', decs.normal.length, 0, '#475467']] : []),
    ...(decs.reab.length ? [['reab', '↺ Reabiertas', decs.reab.length, 0, '#475467']] : []),
  ]
  const vis = filtro === 'todas' ? decs.filas : filtro === 'reab' ? decs.reab : decs.filas.filter(x => x.est === filtro)
  return (
    <div style={{ ...caja, marginTop: 12, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13.5 }}>Decisiones de horas extra</b>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>del período a la vista · cada cambio queda registrado con quién, cuándo y por qué</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {chips.map(([k, l, n, m, c]) => (
            <button key={k} onClick={() => setFiltro(k)} style={{ padding: '4px 10px', borderRadius: 100, fontSize: 12, fontWeight: 650, cursor: 'pointer', minHeight: 0, lineHeight: 1.4,
              border: `1px solid ${filtro === k ? c : 'var(--border)'}`, background: filtro === k ? `${c}14` : 'var(--bg-surface)', color: c }}>
              {l} {n}{m ? ` · ${fMin(m)}` : ''}</button>
          ))}
        </div>
      </div>
      {errDec && <div style={{ padding: '8px 14px', color: '#B42318', fontSize: 12 }}>No se pudo leer el historial de decisiones: {errDec}</div>}
      {vis.length === 0 ? <div style={{ padding: 18, color: 'var(--text-muted)', fontSize: 12.5 }}>Sin decisiones con este filtro.</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ background: 'var(--bg-app)' }}>
              {['Fecha', 'Tipo', 'Detectado', 'Decisión', 'Se paga', 'Decidió', 'Justificación'].map((t, i) => <th key={i} style={thD}>{t}</th>)}
            </tr></thead>
            <tbody>{vis.map(x => {
              const e = x.vigente, E = ETQ[x.est] || ETQ.normal
              return (
                <Fragment key={x.key}>
                  <tr style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={tdD}><button onClick={() => onDia(x.fecha)} title='Ver el día en el calendario' style={{ ...lnk, color: 'var(--text)', fontWeight: 650, whiteSpace: 'nowrap' }}>
                      <span style={{ textTransform: 'capitalize' }}>{DIA_L[utc(x.fecha).getUTCDay()].slice(0, 3)}</span> {fFecha(x.fecha).slice(0, 5)}</button></td>
                    <td style={{ ...tdD, whiteSpace: 'nowrap' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <i style={{ width: 9, height: 9, borderRadius: 2, background: TIPO_D[x.tipo].c, display: 'inline-block' }} />{TIPO_D[x.tipo].l}</span></td>
                    <td style={{ ...tdD, ...NUM }}>{x.det != null ? fMin(x.det) : '—'}</td>
                    <td style={tdD}><span style={{ padding: '2px 9px', borderRadius: 100, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
                      background: E.bg, color: E.c, border: `1px solid ${E.bd}` }}>{E.s} {e ? e.etq : 'Por decidir'}</span>
                      {puede && e ? <div><button onClick={() => onReabrir(x)} style={{ ...lnk, fontSize: 11.5, marginTop: 4 }}>Reabrir…</button></div>
                        : x.est === 'pend' ? <div style={{ fontSize: 11, color: '#9A3412', marginTop: 3 }}>se decide en la bandeja</div> : null}</td>
                    <td style={{ ...tdD, ...NUM, fontWeight: 700, whiteSpace: 'nowrap', color: x.est === 'aut' ? '#1E7A44' : 'var(--text-muted)' }}>
                      {x.est === 'pend' ? '—' : x.feriado ? 'feriado (aparte)' : x.est === 'aut' ? fMin(x.paga) : '0m'}</td>
                    <td style={{ ...tdD, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{e ? <>{e.por || '—'}<div style={{ fontSize: 11 }}>{fDT(e.at)}</div></> : '—'}</td>
                    <td style={{ ...tdD, color: 'var(--text-muted)', minWidth: 170, maxWidth: 300 }}>{e?.just ? `“${e.just}”` : ''}</td>
                  </tr>
                  {x.hist.map(h => <tr key={h.id}><td /><td colSpan={6} style={{ padding: '0 10px 8px', fontSize: 11.5, color: 'var(--text-muted)' }}>↺ {textoHist(h)}</td></tr>)}
                </Fragment>
              )
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Reabrir una decisión: motivo obligatorio y, si se quiere, la nueva decisión en el mismo paso
function ModalReabrir({ g, onCerrar, onHecho }) {
  const e = g.vigente, ft = g.tipo === 'ft', aut = e.est === 'aut'
  const pend = ['pend', 'Reabrir y dejar por decidir', 'Vuelve a la bandeja «Todo por decidir» para decidirla de nuevo.']
  const ops = aut
    ? [pend, [ft ? 'no_corresponde' : 'rechazada', ft ? 'Reabrir: no corresponde pagar' : g.tipo === 'ent' ? 'Reabrir: no requerida' : 'Reabrir y rechazar', 'Deja de pagarse.']]
    : [[ft ? 'horas_extra' : 'autorizada', ft ? 'Reabrir y pagar como horas extra' : `Reabrir y autorizar ${fMin(e.min)}`,
        g.tipo === 'ent' ? 'Autoriza todo lo que llegó antes del turno. Para autorizar solo un tramo, déjala por decidir y decídela en la bandeja.' : 'Entra a la pre-nómina del período.'], pend]
  const [op, setOp] = useState(ops[0][0])
  const m0 = e.minTrab ?? g.det ?? 0
  const [h, setH] = useState(Math.floor(m0 / 60)), [mm, setMm] = useState(m0 % 60)
  const [motivo, setMotivo] = useState(''), [guard, setGuard] = useState(false), [err, setErr] = useState(null)
  const min = (Number(h) || 0) * 60 + (Number(mm) || 0)
  async function ok() {
    if (motivo.trim().length < 10) return setErr('Indica el motivo de la reapertura (mínimo 10 caracteres).')
    if (op === 'horas_extra' && min <= 0) return setErr('Indica cuánto tiempo se paga.')
    setGuard(true); setErr(null)
    const { error } = await supabase.rpc('fn_asis_reabrir_decision', { p_origen: e.origen, p_id: e.id, p_motivo: motivo.trim(),
      p_nueva: op === 'pend' ? null : op, p_minutos: op === 'horas_extra' ? min : null })
    setGuard(false)
    if (error) return setErr(error.message)
    const txt = op === 'pend' ? 'quedó por decidir en la bandeja' : op === 'autorizada' ? `quedó autorizada (${fMin(e.min)})`
      : op === 'horas_extra' ? `se paga como hora extra (${fMin(min)})` : 'quedó sin pago'
    onHecho(`${TIPO_D[g.tipo].l} del ${fFecha(g.fecha)}: decisión reabierta, ${txt}. Queda registrado en el historial.`)
  }
  const E = ETQ[e.est] || ETQ.normal
  return (
    <div role='dialog' aria-modal='true' onMouseDown={() => !guard && onCerrar()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onMouseDown={ev => ev.stopPropagation()} style={{ background: 'var(--bg-surface)', borderRadius: 14, width: 'min(540px,100%)', padding: 20, boxShadow: '0 20px 50px rgba(0,0,0,.25)' }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Reabrir decisión</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '3px 0 12px' }}>
          {TIPO_D[g.tipo].l} · <span style={{ textTransform: 'capitalize' }}>{DIA_L[utc(g.fecha).getUTCDay()]}</span> {fFecha(g.fecha)} · detectado {g.det != null ? fMin(g.det) : 's/d'}</div>
        <div style={{ fontSize: 12.5, padding: '8px 10px', borderRadius: 9, background: 'var(--bg-app)', marginBottom: 12 }}>
          Decisión vigente: <b style={{ color: E.c }}>{E.s} {e.etq}{e.min ? ` (${fMin(e.min)})` : ''}</b> · {e.por || '—'} {fDT(e.at)}
          {e.just && <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>“{e.just}”</div>}
        </div>
        <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          {ops.map(([k, l, d]) => (
            <label key={k} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 9, cursor: 'pointer',
              border: `1px solid ${op === k ? '#16213E' : 'var(--border)'}`, background: op === k ? 'var(--bg-app)' : 'transparent' }}>
              <input type='radio' checked={op === k} onChange={() => setOp(k)} style={{ marginTop: 3 }} />
              <span><b style={{ fontSize: 13 }}>{l}</b><div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{d}</div></span>
            </label>
          ))}
        </div>
        {op === 'horas_extra' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, fontSize: 13 }}>
            Se pagan <input type='number' min='0' value={h} onChange={ev => setH(ev.target.value)} style={{ ...inpM, width: 64 }} /> h
            <input type='number' min='0' max='59' value={mm} onChange={ev => setMm(ev.target.value)} style={{ ...inpM, width: 64 }} /> min
          </div>
        )}
        <textarea value={motivo} onChange={ev => setMotivo(ev.target.value)} rows={3} placeholder='Motivo de la reapertura (obligatorio): qué cambió o qué se revisó'
          style={{ ...inpM, width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Queda registrado quién reabre, cuándo y por qué; la decisión anterior se conserva en el historial.</div>
        {err && <div style={{ color: '#B42318', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onCerrar} disabled={guard} style={{ ...btnM, background: 'var(--bg-surface)', color: 'var(--text)' }}>Cancelar</button>
          <button onClick={ok} disabled={guard} style={{ ...btnM, background: '#16213E', color: '#fff', borderColor: '#16213E' }}>{guard ? 'Guardando…' : 'Reabrir'}</button>
        </div>
      </div>
    </div>
  )
}
const inpM = { padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, background: 'var(--bg-surface)', color: 'var(--text)', fontFamily: 'inherit' }
const btnM = { padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 650, cursor: 'pointer', border: '1px solid var(--border)' }

const ORIG = [{ k: 'heSal', l: 'Después del turno', c: '#16213E' }, { k: 'heEnt', l: 'Llegada anticipada', c: '#B25E09' }, { k: 'heFt', l: 'Fuera de turno', c: '#6941C6' }]

function Ind({ l, v, s, c }) {
  return (
    <div style={{ ...caja, padding: '9px 12px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div>
      <div style={{ ...NUM, fontSize: 20, fontWeight: 800, color: c, lineHeight: 1.25 }}>{v}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s}</div>
    </div>
  )
}

// El día en una línea de tiempo: lo esperado (turno) contra lo marcado, y quién decidió qué
function DetalleDia({ f, d, h, j, a, noms, tipo, gr = {}, puede, onReabrir }) {
  const T = TIPOS[tipo], dt = utc(f)
  const eE = minDia(d?.entrada_esperada, f), sE = minDia(d?.salida_esperada, f), eR = minDia(d?.entrada_real, f), sR = minDia(d?.salida_real, f)
  const cI = minDia(j?.inicio_colacion_real, f), cF = minDia(j?.fin_colacion_real, f)
  const pts = [eE, sE, eR, sR].filter(x => x != null)
  const a0 = pts.length ? Math.floor((Math.min(...pts) - 30) / 60) * 60 : 0, a1 = pts.length ? Math.ceil((Math.max(...pts) + 30) / 60) * 60 : 0
  const x = m => `${(m - a0) / Math.max(a1 - a0, 1) * 100}%`, w = (p, q) => `${Math.max(q - p, 0) / Math.max(a1 - a0, 1) * 100}%`
  const horas = []; for (let m = a0; m <= a1; m += (a1 - a0 > 720 ? 120 : 60)) horas.push(m)
  const quien = id => id ? (noms[id] || id) : null
  const dec = h ? [
    h.min_salida_det > 0 && { k: 'sal', o: 'Después del turno', det: h.min_salida_det, aut: h.min_salida_aprob, est: h.salida_decision, por: quien(h.salida_validado_por), just: h.salida_justificacion },
    h.min_entrada_det > 0 && { k: 'ent', o: 'Llegada anticipada', det: h.min_entrada_det, aut: h.min_entrada_aprob, est: h.entrada_decision, por: quien(h.entrada_validado_por), just: h.entrada_justificacion, ent: true },
    (h.tipo_dia === 'fuera_turno' || h.ft_decision === 'horas_extra') && { k: 'ft', o: 'Fuera de turno', det: h.min_ft_trab, aut: h.min_ft_aprob,
      est: h.ft_decision === 'horas_extra' ? 'autorizada' : h.ft_decision === 'no_corresponde' ? 'rechazada' : h.ft_decision ? null : undefined, por: h.ft_decidido_por_nombre, just: h.ft_motivo },
  ].filter(Boolean) : []
  const estado = e => e === 'autorizada' ? ['Autorizada', '#1E7A44'] : e ? [e === 'rechazada' ? 'Rechazada' : 'Decidida', '#B42318'] : ['Por decidir', '#9A3412']
  return (
    <div style={{ ...caja, marginTop: 10, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <strong style={{ fontSize: 14, textTransform: 'capitalize' }}>{DIA_L[dt.getUTCDay()]} {fFecha(f)}</strong>
        <span style={{ padding: '2px 9px', borderRadius: 100, fontSize: 11.5, fontWeight: 700, background: T.bg, color: T.fg, border: `1px solid ${T.bd}` }}>
          {T.l}{tipo === 'atraso' ? ` de ${fMin(d.min_atraso)}` : ''}{d?.en_tolerancia ? ' (dentro de la tolerancia)' : ''}</span>
        {d?.es_feriado && <span style={{ fontSize: 11.5, fontWeight: 700, color: '#6E6E73' }}>Feriado{j?.feriado_nombre ? `: ${j.feriado_nombre}` : ''} · no genera horas extra, se paga aparte</span>}
        {d?.atipico === 'validado' && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Marcaje validado por Gestión de Personas</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{d?.turno || j?.workshift_name || 'Sin turno'}{j?.turno_corregido ? ' · turno corregido' : ''}</span>
      </div>

      {pts.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ position: 'relative', height: 44 }}>
            {eE != null && sE != null && <div title='Turno' style={{ position: 'absolute', top: 2, height: 16, left: x(eE), width: w(eE, sE), background: '#EEF0F5', border: '1px solid #C9CEDA', borderRadius: 4 }} />}
            {eR != null && sR != null && <div title='Presencia' style={{ position: 'absolute', top: 24, height: 16, left: x(eR), width: w(eR, sR), background: '#9AA5B8', borderRadius: 4 }} />}
            {eR != null && eE != null && eR < eE && sR != null && <div title='Antes del turno' style={{ position: 'absolute', top: 24, height: 16, left: x(eR), width: w(eR, Math.min(eE, sR)), background: '#B25E09', borderRadius: '4px 0 0 4px' }} />}
            {sR != null && sE != null && sR > sE && <div title='Después del turno' style={{ position: 'absolute', top: 24, height: 16, left: x(Math.max(sE, eR ?? sE)), width: w(Math.max(sE, eR ?? sE), sR), background: '#16213E', borderRadius: '0 4px 4px 0' }} />}
            {eR != null && eE != null && eR > eE && <div title='Atraso' style={{ position: 'absolute', top: 2, height: 16, left: x(eE), width: w(eE, Math.min(eR, sE ?? eR)), background: 'repeating-linear-gradient(45deg,#F5D3A4,#F5D3A4 4px,#FFF1DE 4px,#FFF1DE 8px)', borderRadius: '4px 0 0 4px' }} />}
            {cI != null && cF != null && <div title='Colación' style={{ position: 'absolute', top: 24, height: 16, left: x(cI), width: w(cI, cF), background: 'var(--bg-surface)', opacity: .85 }} />}
            {eR != null && sR == null && <div title='Entrada sin salida' style={{ position: 'absolute', top: 22, height: 20, left: x(eR), width: 3, background: '#B25E09' }} />}
          </div>
          <div style={{ position: 'relative', height: 14, borderTop: '1px solid var(--border)' }}>
            {horas.map(m => <span key={m} style={{ ...NUM, position: 'absolute', left: x(m), transform: 'translateX(-50%)', fontSize: 9.5, color: 'var(--text-muted)' }}>{p2(Math.floor(m / 60) % 24)}:00</span>)}
          </div>
          <div style={{ display: 'flex', gap: '2px 16px', flexWrap: 'wrap', fontSize: 12, marginTop: 8 }}>
            <span><span style={{ color: 'var(--text-muted)' }}>Turno</span> <b style={NUM}>{hora(d?.entrada_esperada) || '—'} – {hora(d?.salida_esperada) || '—'}</b></span>
            <span><span style={{ color: 'var(--text-muted)' }}>Marcó</span> <b style={NUM}>{hora(d?.entrada_real) || 'sin entrada'} – {hora(d?.salida_real) || 'sin salida'}</b></span>
            {cI != null && cF != null && <span><span style={{ color: 'var(--text-muted)' }}>Colación</span> <b style={NUM}>{hora(j.inicio_colacion_real)} – {hora(j.fin_colacion_real)}</b></span>}
            {j?.min_trabajados_efectivos != null && <span><span style={{ color: 'var(--text-muted)' }}>Trabajó</span> <b style={NUM}>{fMin(j.min_trabajados_efectivos)}</b></span>}
            {j?.min_salida_anticipada_contable > 0 && <span style={{ color: '#B42318' }}>Salió {fMin(j.min_salida_anticipada_contable)} antes</span>}
            {d?.n_marcas != null && <span style={{ color: 'var(--text-muted)' }}>{d.n_marcas} {d.n_marcas === 1 ? 'marca' : 'marcas'}</span>}
          </div>
        </div>
      )}
      {pts.length === 0 && tipo !== 'libre' && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 8 }}>Sin marcas ese día.</div>}

      {a && <div style={{ fontSize: 12.5, marginBottom: 8 }}><b>Ausencia gestionada:</b> {String(a.clasificacion || '').replace(/_/g, ' ')}{a.justificacion ? ` — “${a.justificacion}”` : ''}{a.gestionado_por ? <span style={{ color: 'var(--text-muted)' }}> · {quien(a.gestionado_por)}</span> : null}</div>}

      {dec.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 9 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 5 }}>
            <b style={{ fontSize: 12.5 }}>Tiempo extra del día</b>
            {!h.es_feriado && <span style={{ ...NUM, fontSize: 12.5 }}>se pagan <b>{fMin(h.min_autorizados)}</b>{h.min_tramo_exceso > 0 ? <span style={{ color: '#B42318' }}> · {fMin(h.min_tramo_exceso)} sobre el tope de 2 h</span> : null}{h.min_pendientes > 0 ? <span style={{ color: '#9A3412' }}> · {fMin(h.min_pendientes)} por decidir</span> : null}</span>}
          </div>
          {dec.map(x => { const [et, ec] = x.ent && x.est && x.est !== 'autorizada' ? ['No requerida', '#6E6E73'] : estado(x.est); return (
            <div key={x.o} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12.5, padding: '2px 0' }}>
              <span style={{ minWidth: 128, color: 'var(--text-muted)' }}>{x.o}</span>
              <b style={{ ...NUM, minWidth: 54 }}>{x.det != null ? fMin(x.det) : 's/d'}</b>
              <b style={{ color: ec }}>{et}{x.est === 'autorizada' && x.aut != null && x.aut < x.det ? ` (${fMin(x.aut)})` : ''}</b>
              {x.por && <span style={{ color: 'var(--text-muted)' }}>· {x.por}</span>}
              {puede && gr[x.k]?.vigente && <button onClick={() => onReabrir(gr[x.k])} style={{ ...lnk, marginLeft: 'auto' }}>Reabrir…</button>}
              {(gr[x.k]?.hist || []).map(e => <div key={e.id} style={{ flexBasis: '100%', paddingLeft: 136, fontSize: 11.5, color: 'var(--text-muted)' }}>↺ {textoHist(e)}</div>)}
              {x.just && <i style={{ color: 'var(--text-muted)', flexBasis: '100%', paddingLeft: 136 }}>“{x.just}”</i>}
            </div>) })}
        </div>
      )}
    </div>
  )
}

const caja = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px' }
const nav = { width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-surface)', color: 'var(--text)', cursor: 'pointer', fontSize: 15 }
const lnk = { background: 'none', border: 'none', padding: 0, minHeight: 0, height: 'auto', lineHeight: 1.35, cursor: 'pointer', color: 'var(--accent, #4F46E5)', fontSize: 12, fontWeight: 600 }
