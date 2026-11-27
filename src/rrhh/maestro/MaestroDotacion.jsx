// ═══════════════════════════════════════════════════════════════════════════
// MAESTRO DE DOTACIÓN Y BITÁCORA DEL TRABAJADOR · app Personas · v2 (27-11-2026)
// v2: horas extra (días y horas registradas en el reloj vs autorizadas por la jefatura,
// y lo pagado en la liquidación), por período de pago con corte del 26 al 25; mes en curso.
// Una sola pantalla para ver a cada persona completa:
//   · Maestro: una fila por trabajador con contrato, asistencia, permisos,
//     marcaje, última evaluación, amonestaciones y remuneración.
//   · Bitácora: al abrir a una persona, su historia en orden cronológico y el
//     detalle por tema (asistencia y marcaje, permisos y ausencias, evaluaciones,
//     antecedentes, remuneraciones, ficha y contratos).
// Datos: fn_rrhh_maestro y fn_rrhh_bitacora (solo lectura). La asistencia usa el
// mismo criterio que la Evaluación de Desempeño (fn_asis_dias): tolerancia del
// art. 27, errores de marcaje y validaciones de Gestión de Personas.
// Acceso: solo Gestión de Personas y administración (lo exige la base de datos).
// Los montos de remuneraciones solo se entregan a quien tiene acceso a
// remuneraciones; las liquidaciones confidenciales las protege la base.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabase'
import { DataGrid, fechaExcel, ANCHO_FECHA_XLS } from '../../finanzas/conciliacion/DataGrid'

// ─── Utilidades ───────────────────────────────────────────────────────────────
const hoyCL = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
const masDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const fFecha = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : '—' }
const nomProp = s => String(s || '').toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).trim()
const oracion = s => { const t = String(s || '').toLowerCase().trim(); return t.charAt(0).toUpperCase() + t.slice(1) }
const fmtCLP = n => n == null ? '—' : new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const mesL = p => { const m = /^(\d{4})-(\d{2})/.exec(String(p || '')); return m ? `${MESES[+m[2] - 1]} ${m[1]}` : (p || '—') }
const finDeMes = p => { const m = /^(\d{4})-(\d{2})/.exec(String(p || '')); if (!m) return null; return new Date(Date.UTC(+m[1], +m[2], 0)).toISOString().slice(0, 10) }
const mesesEntre = (a, b) => { if (!a || !b) return null; const x = new Date(a + 'T12:00:00Z'), y = new Date(b + 'T12:00:00Z'); let n = (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + (y.getUTCMonth() - x.getUTCMonth()); if (y.getUTCDate() < x.getUTCDate()) n--; return Math.max(0, n) }
const antigL = n => n == null ? '—' : n < 12 ? `${n} m` : `${Math.floor(n / 12)} a${n % 12 ? ` ${n % 12} m` : ''}`
const fmtH = m => m == null ? '—' : `${(Number(m) / 60).toFixed(1).replace('.', ',')} h`
const diasHasta = f => f ? Math.round((new Date(f + 'T12:00:00Z') - new Date(hoyCL() + 'T12:00:00Z')) / 864e5) : null

const PERIODOS = [
  { k: 'mes', l: 'Mes en curso' }, { k: 'mes_ant', l: 'Mes anterior' },
  { k: '90d', l: 'Últimos 90 días' }, { k: '6m', l: 'Últimos 6 meses' },
  { k: 'anio', l: 'Año en curso' }, { k: '12m', l: 'Últimos 12 meses' },
]
const rango = k => {
  const h = hoyCL()
  if (k === 'mes') return { desde: `${h.slice(0, 7)}-01`, hasta: h }
  if (k === 'mes_ant') { const fin = masDias(`${h.slice(0, 7)}-01`, -1); return { desde: `${fin.slice(0, 7)}-01`, hasta: fin } }
  if (k === '6m') return { desde: masDias(h, -182), hasta: h }
  if (k === 'anio') return { desde: `${h.slice(0, 4)}-01-01`, hasta: h }
  if (k === '12m') return { desde: masDias(h, -365), hasta: h }
  return { desde: masDias(h, -90), hasta: h }
}

const cPct = p => p == null ? 'var(--text-muted)' : p >= 95 ? '#1E7A44' : p >= 85 ? '#B25E09' : '#B42318'
const catDe = n => n == null ? null : n >= 4.3 ? { l: 'Destacado', c: '#1E7A44' } : n >= 3.6 ? { l: 'Competente', c: '#175CD3' } : n >= 2.9 ? { l: 'En desarrollo', c: '#B25E09' } : { l: 'Insuficiente', c: '#B42318' }
const RECOM_L = { plena: 'Continuidad plena', con_plan: 'Continuidad con plan de mejora', no_continuidad: 'No continuidad' }
const CONTRATO_L = { indefinido: 'Indefinido', plazo_fijo: 'Plazo fijo' }
const TIPOS_ANT = [
  { k: 'retroalimentacion', l: 'Retroalimentación' }, { k: 'amonestacion_verbal', l: 'Amonestación verbal' },
  { k: 'amonestacion_escrita', l: 'Amonestación escrita' }, { k: 'compromiso', l: 'Compromiso' },
  { k: 'reconocimiento', l: 'Reconocimiento' }, { k: 'otro', l: 'Otro' },
]
const antL = k => TIPOS_ANT.find(t => t.k === k)?.l || k
const CLASE_L = {
  licencia_medica: 'Licencia médica', vacaciones: 'Vacaciones', permiso_con_goce: 'Permiso con goce', permiso_sin_goce: 'Permiso sin goce',
  falta_injustificada: 'Falta injustificada', otro: 'Otro',
}
const CAMPO_L = {
  activo: 'estado', alta: 'alta en el maestro', cargo_contractual: 'cargo contractual', centro_costo_codigo: 'centro de costo', cuenta_madre_codigo: 'cuenta contable',
  exento_asistencia: 'exención de control de asistencia', exento_motivo: 'motivo de exención', fecha_egreso: 'fecha de egreso', fecha_ingreso: 'fecha de ingreso',
  nombre: 'nombre', rut: 'RUT', sucursal_id: 'sucursal',
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const NAVY = '#16213E'
const card = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10 }
const inp = { padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12.5, background: '#fff', color: 'var(--text)', fontFamily: 'inherit' }
const btn = { padding: '7px 13px', borderRadius: 7, border: '1px solid var(--border)', background: '#fff', color: NAVY, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
const btnP = { ...btn, background: NAVY, color: '#fff', border: `1px solid ${NAVY}` }
const th = { textAlign: 'left', padding: '7px 10px', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', background: 'var(--bg-card)' }
const td = { padding: '6px 10px', fontSize: 12.5, borderBottom: '1px solid var(--border)', verticalAlign: 'top' }
const chip = (c) => ({ display: 'inline-block', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: c + '18', color: c, whiteSpace: 'nowrap' })

function Kpi({ l, v, s, c }) {
  return (
    <div style={{ ...card, padding: '10px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{l}</div>
      <div style={{ fontSize: 21, fontWeight: 800, color: c || 'var(--text)', lineHeight: 1.25 }}>{v}</div>
      {s && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s}</div>}
    </div>
  )
}

// Tabla compacta genérica: cols = [{ k, l, a?, w?, r?(fila) }]
function Tabla({ cols, filas, vacio = 'Sin registros en el período.' }) {
  if (!filas?.length) return <div style={{ padding: '14px 12px', fontSize: 12.5, color: 'var(--text-muted)' }}>{vacio}</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{cols.map(c => <th key={c.k} style={{ ...th, textAlign: c.a || 'left', width: c.w }}>{c.l}</th>)}</tr></thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i}>{cols.map(c => <td key={c.k} style={{ ...td, textAlign: c.a || 'left', whiteSpace: c.nw ? 'nowrap' : 'normal' }}>{c.r ? c.r(f) : (f[c.k] ?? '—')}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Seccion({ titulo, nota, children, extra }) {
  return (
    <div style={{ ...card, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{titulo}</div>
        {nota && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{nota}</div>}
        <div style={{ marginLeft: 'auto' }}>{extra}</div>
      </div>
      {children}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAESTRO
// ═══════════════════════════════════════════════════════════════════════════
export function MaestroDotacion({ cu }) {
  const [per, setPer] = useState('mes')
  const [egr, setEgr] = useState(false)
  const [suc, setSuc] = useState('todas')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [carg, setCarg] = useState(true)
  const [err, setErr] = useState(null)
  const [sel, setSel] = useState(null)
  const r = useMemo(() => rango(per), [per])

  const cargar = useCallback(async () => {
    setCarg(true); setErr(null)
    const { data, error } = await supabase.rpc('fn_rrhh_maestro', { p_desde: r.desde, p_hasta: r.hasta, p_incluir_egresados: egr })
    if (error) setErr(error.message)
    setRows((data || []).map(x => ({ ...x, _ant: mesesEntre(x.fecha_ingreso, x.fecha_egreso || hoyCL()), _vence: x.contrato_tipo === 'plazo_fijo' ? diasHasta(x.contrato_termino) : null })))
    setCarg(false)
  }, [r.desde, r.hasta, egr])
  useEffect(() => { cargar() }, [cargar])

  const veRemu = rows.some(x => x.ve_remuneracion)
  const sucs = useMemo(() => [...new Set(rows.map(x => x.sucursal).filter(Boolean))].sort(), [rows])
  const fil = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rows.filter(x => (suc === 'todas' || x.sucursal === suc) && (!t || `${x.nombre} ${x.rut || ''} ${x.cargo || ''} ${x.jefatura || ''}`.toLowerCase().includes(t)))
  }, [rows, suc, q])

  const k = useMemo(() => {
    const act = fil.filter(x => x.activo)
    const conAs = act.filter(x => x.pct_asistencia != null), conPu = act.filter(x => x.pct_puntualidad != null)
    const prom = (a, f) => a.length ? Math.round(a.reduce((s, x) => s + x[f], 0) / a.length) : null
    return {
      n: act.length, pf: act.filter(x => x.contrato_tipo === 'plazo_fijo').length,
      vence: act.filter(x => x._vence != null && x._vence >= 0 && x._vence <= 30).length,
      asis: prom(conAs, 'pct_asistencia'), punt: prom(conPu, 'pct_puntualidad'),
      aus: act.filter(x => x.ausencias > 0).length, amon: act.filter(x => x.amonestaciones > 0).length,
      sinEval: act.filter(x => x.evaluable && !x.eval_n).length, verif: act.filter(x => x.atrasos_por_verificar > 0).length,
      heReg: fil.reduce((s, x) => s + (x.he_min_reg || 0), 0), heAut: fil.reduce((s, x) => s + (x.he_min_aut || 0), 0),
      hePend: fil.reduce((s, x) => s + (x.he_min_pend || 0), 0), heDiasAut: fil.reduce((s, x) => s + (x.he_dias_aut || 0), 0),
    }
  }, [fil])

  const cols = useMemo(() => {
    const num = (key, label, width = 104) => ({ key, label, width, align: 'right', value: x => x[key] ?? 0, render: x => x[key] ? x[key] : <span style={{ color: '#C7C7CC' }}>0</span> })
    const pct = (key, label) => ({ key, label, width: 130, align: 'right', value: x => x[key] ?? -1, exportValue: x => x[key], render: x => x[key] == null ? <span style={{ color: 'var(--text-muted)' }}>s/d</span> : <strong style={{ color: cPct(x[key]) }}>{x[key]}%</strong> })
    const base = [
      { key: 'nombre', label: 'Trabajador', width: 230, value: x => nomProp(x.nombre), render: x => <span style={{ fontWeight: 700, color: NAVY }}>{nomProp(x.nombre)}{!x.activo && <span style={{ ...chip('#6E6E73'), marginLeft: 6 }}>EGRESADO</span>}</span> },
      { key: 'rut', label: 'RUT', width: 108 },
      { key: 'cargo', label: 'Cargo', width: 190, value: x => x.cargo || '' },
      { key: 'sucursal', label: 'Sucursal', width: 120 },
      { key: 'jefatura', label: 'Jefatura', width: 170, value: x => x.jefatura || '', render: x => x.jefatura || <span style={{ color: '#B25E09' }}>Sin jefatura</span> },
      { key: 'fecha_ingreso', label: 'Ingreso', width: 106, fecha: true },
      { key: '_ant', label: 'Antigüedad', width: 118, align: 'right', value: x => x._ant ?? -1, exportValue: x => x._ant, render: x => antigL(x._ant) },
      { key: 'contrato_tipo', label: 'Contrato', width: 112, value: x => CONTRATO_L[x.contrato_tipo] || 'Sin registro' },
      { key: 'contrato_termino', label: 'Vence', width: 110, fecha: true,
        render: x => x.contrato_termino ? <span style={{ fontWeight: x._vence != null && x._vence <= 30 ? 700 : 400, color: x._vence != null && x._vence < 0 ? '#B42318' : x._vence != null && x._vence <= 30 ? '#B25E09' : 'inherit' }}>{fFecha(x.contrato_termino)}</span> : '' },
      pct('pct_asistencia', 'Asistencia'), pct('pct_puntualidad', 'Puntualidad'),
      num('ausencias', 'Ausencias', 110), num('atrasos', 'Atrasos'), num('min_atraso', 'Min. atraso', 116),
      num('marcajes_atipicos', 'Marcaje atípico', 138), num('atrasos_por_verificar', 'Por verificar', 124),
      num('dias_licencia', 'Licencia', 102), num('dias_permiso', 'Permisos', 104), num('dias_vacaciones', 'Vacaciones', 116),
      num('he_dias', 'Días con HE', 116),
      { key: 'he_min_reg', label: 'HE registradas', width: 136, align: 'right', value: x => x.he_min_reg || 0, exportValue: x => +((x.he_min_reg || 0) / 60).toFixed(2), render: x => x.he_min_reg ? fmtH(x.he_min_reg) : <span style={{ color: '#C7C7CC' }}>0</span> },
      { key: 'he_min_aut', label: 'HE autorizadas', width: 136, align: 'right', value: x => x.he_min_aut || 0, exportValue: x => +((x.he_min_aut || 0) / 60).toFixed(2), render: x => x.he_min_aut ? <strong>{fmtH(x.he_min_aut)}</strong> : <span style={{ color: '#C7C7CC' }}>0</span> },
      { key: 'he_min_pend', label: 'HE por validar', width: 136, align: 'right', value: x => x.he_min_pend || 0, exportValue: x => +((x.he_min_pend || 0) / 60).toFixed(2), render: x => x.he_min_pend ? <strong style={{ color: '#B25E09' }}>{fmtH(x.he_min_pend)}</strong> : <span style={{ color: '#C7C7CC' }}>0</span> },
      { key: 'vacaciones_saldo', label: 'Saldo vacaciones', width: 146, align: 'right', value: x => x.vacaciones_saldo ?? -999, exportValue: x => x.vacaciones_saldo, render: x => x.vacaciones_saldo == null ? '' : Number(x.vacaciones_saldo).toFixed(1) },
      { key: 'eval_nota', label: 'Última evaluación', width: 170, value: x => x.eval_nota ?? -1, exportValue: x => x.eval_nota,
        render: x => { const c = catDe(x.eval_nota); return c ? <span><strong style={{ color: c.c }}>{Number(x.eval_nota).toFixed(2)}</strong> <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.l}</span></span> : <span style={{ color: 'var(--text-muted)' }}>{x.evaluable ? 'Sin evaluar' : 'No evaluable'}</span> } },
      { key: 'eval_fecha', label: 'Fecha evaluación', width: 148, fecha: true },
      { key: 'eval_recomendacion', label: 'Recomendación', width: 190, value: x => RECOM_L[x.eval_recomendacion] || '' },
      { key: 'amonestaciones', label: 'Amonestaciones', width: 140, align: 'right', value: x => x.amonestaciones ?? 0, render: x => x.amonestaciones ? <strong style={{ color: '#B42318' }}>{x.amonestaciones}</strong> : <span style={{ color: '#C7C7CC' }}>0</span> },
      num('antecedentes', 'Antecedentes', 126),
    ]
    if (veRemu) base.push(
      { key: 'remu_liquido', label: 'Líquido', width: 112, align: 'right', value: x => x.remu_liquido ?? -1, exportValue: x => x.remu_liquido, render: x => x.remu_liquido == null ? '' : fmtCLP(x.remu_liquido) },
      { key: 'remu_haberes', label: 'Haberes', width: 112, align: 'right', value: x => x.remu_haberes ?? -1, exportValue: x => x.remu_haberes, render: x => x.remu_haberes == null ? '' : fmtCLP(x.remu_haberes) },
      { key: 'remu_periodo', label: 'Mes liquidación', width: 140, value: x => x.remu_periodo || '', render: x => x.remu_periodo ? mesL(x.remu_periodo) : '' },
    )
    return base
  }, [veRemu])

  if (sel != null) return <BitacoraTrabajador cod={sel} cu={cu} perIni={per} onVolver={() => { setSel(null); cargar() }} />

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19, color: NAVY }}>Maestro de dotación</h2>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
            Cada trabajador con su contrato, asistencia, permisos, marcaje, evaluación, amonestaciones{veRemu ? ' y remuneración' : ''}. Haz clic en una fila para abrir su bitácora.
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder='Buscar nombre, RUT, cargo o jefatura' style={{ ...inp, width: 250 }} />
          <select value={suc} onChange={e => setSuc(e.target.value)} style={inp}>
            <option value='todas'>Todas las sucursales</option>
            {sucs.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={per} onChange={e => setPer(e.target.value)} style={inp} title='Período de los indicadores de asistencia'>
            {PERIODOS.map(p => <option key={p.k} value={p.k}>{p.l}</option>)}
          </select>
          <label style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input type='checkbox' checked={egr} onChange={e => setEgr(e.target.checked)} /> Incluir egresados
          </label>
        </div>
      </div>

      {err && <div style={{ ...card, borderColor: '#F3C5C0', background: '#FEF3F2', color: '#B42318', padding: '10px 14px', marginBottom: 12, fontSize: 12.5 }}>No se pudo cargar el maestro: {err}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        <Kpi l='Dotación activa' v={k.n} s={`${k.pf} a plazo fijo`} />
        <Kpi l='Contratos por vencer' v={k.vence} s='en los próximos 30 días' c={k.vence ? '#B25E09' : undefined} />
        <Kpi l='Asistencia promedio' v={k.asis == null ? 's/d' : `${k.asis}%`} s={`${fFecha(r.desde)} a ${fFecha(r.hasta)}`} c={cPct(k.asis)} />
        <Kpi l='Puntualidad promedio' v={k.punt == null ? 's/d' : `${k.punt}%`} s='tolerancia art. 27' c={cPct(k.punt)} />
        <Kpi l='Con ausencias' v={k.aus} s='sin justificar en el período' c={k.aus ? '#B42318' : undefined} />
        <Kpi l='Horas extra' v={fmtH(k.heAut)} s={`autorizadas de ${fmtH(k.heReg)} registradas${k.hePend ? ` · ${fmtH(k.hePend)} por validar` : ''}`} c={k.hePend ? '#B25E09' : undefined} />
        <Kpi l='Atrasos por verificar' v={k.verif} s='personas con atrasos sobre 2 h' c={k.verif ? '#B25E09' : undefined} />
        <Kpi l='Con amonestaciones' v={k.amon} s='registradas en antecedentes' c={k.amon ? '#B42318' : undefined} />
        <Kpi l='Sin evaluación' v={k.sinEval} s='evaluables sin ninguna enviada' />
      </div>

      <DataGrid title={`Trabajadores (${fil.length})`} exportName='maestro_dotacion' columns={cols} rows={fil}
        getRowId={x => x.cod_contaline} onRowClick={x => setSel(x.cod_contaline)} loading={carg}
        rowStyle={x => (!x.activo ? { opacity: 0.65 } : {})}
        emptyText={err ? 'Sin datos' : 'No tienes acceso al maestro o no hay trabajadores con ese filtro.'} />
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
        Asistencia y puntualidad se calculan con el mismo criterio que la Evaluación de Desempeño: no cuentan licencias, vacaciones, permisos, feriados ni los días previos al registro en el reloj;
        los atrasos de hasta 5 minutos están dentro de la tolerancia del art. 27, y los errores de marcaje se excluyen. "Por verificar" son atrasos de más de 2 horas que Gestión de Personas aún no valida.
        Horas extra: registradas en el reloj y autorizadas por la jefatura en el ERP, en las fechas del período elegido (el detalle por período de pago, con corte del 26 al 25, está en la bitácora de cada persona).
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// BITÁCORA DEL TRABAJADOR
// ═══════════════════════════════════════════════════════════════════════════
const CATS = [
  { k: 'ficha', l: 'Ficha y contrato', c: '#16213E' }, { k: 'asistencia', l: 'Asistencia y marcaje', c: '#B42318' },
  { k: 'permiso', l: 'Permisos y licencias', c: '#175CD3' }, { k: 'evaluacion', l: 'Evaluaciones', c: '#6941C6' },
  { k: 'antecedente', l: 'Antecedentes', c: '#B25E09' }, { k: 'remuneracion', l: 'Remuneraciones', c: '#1E7A44' },
]

function armarEventos(b) {
  const ev = []
  const p = b.persona || {}
  const add = (fecha, cat, titulo, det) => { if (fecha) ev.push({ fecha: String(fecha).slice(0, 10), cat, titulo, det: det || '' }) }
  add(p.fecha_ingreso, 'ficha', 'Ingreso a la empresa', p.cargo_contractual || p.cargo || '')
  add(p.fecha_egreso, 'ficha', 'Egreso de la empresa', '')
  for (const c of b.contratos || []) {
    add(c.inicio, 'ficha', `Contrato ${String(CONTRATO_L[c.tipo] || c.tipo || '').toLowerCase()}${c.renovacion ? ` (renovación ${c.renovacion})` : ''}`, [c.termino ? `Hasta el ${fFecha(c.termino)}` : '', c.nota].filter(Boolean).join(' · '))
    if (c.tipo === 'plazo_fijo' && c.termino) add(c.termino, 'ficha', 'Vencimiento del plazo fijo', c.termino > hoyCL() ? 'Fecha futura' : '')
  }
  for (const c of b.cambios_ficha || []) add(c.fecha, 'ficha', `Cambio de ${CAMPO_L[c.campo] || c.campo}`, `${c.antes || '—'} → ${c.despues || '—'}${c.origen ? ` · ${c.origen}` : ''}`)
  for (const x of b.permisos || []) add(x.desde, 'permiso', oracion(x.nombre), `${x.desde === x.hasta ? fFecha(x.desde) : `${fFecha(x.desde)} a ${fFecha(x.hasta)}`}${x.comentario ? ` · ${x.comentario}` : ''} · Workera`)
  for (const x of b.novedades || []) add(x.desde, 'permiso', CLASE_L[x.tipo] || oracion(x.tipo), `${x.desde === x.hasta || !x.hasta ? fFecha(x.desde) : `${fFecha(x.desde)} a ${fFecha(x.hasta)}`}${x.motivo ? ` · ${x.motivo}` : ''} · registrada en el ERP`)
  for (const x of b.ausencias || []) add(x.fecha, x.clasificacion === 'falta_injustificada' ? 'asistencia' : 'permiso',
    x.clasificacion === 'falta_injustificada' ? 'Falta injustificada' : `Día sin marca: ${CLASE_L[x.clasificacion] || x.clasificacion}${x.cuenta_trabajado ? ' (cuenta como trabajado)' : ''}`, x.justificacion || '')
  for (const x of (b.incidencias || []).filter(i => i.tipo === 'Ausencia sin justificar')) add(x.fecha, 'asistencia', 'Ausencia sin justificar', x.turno ? `Turno ${x.turno}` : '')
  for (const x of b.validaciones || []) add(x.fecha, 'asistencia', x.decision === 'error_marcaje' ? 'Marcaje validado como error de marcaje' : 'Atraso confirmado por Gestión de Personas', x.motivo || '')
  for (const x of b.correcciones_turno || []) add(x.fecha, 'asistencia', `Corrección de turno: ${x.de || '—'} → ${x.a || '—'}`, [x.motivo, x.estado].filter(Boolean).join(' · '))
  for (const x of b.evaluaciones || []) add(x.fecha, 'evaluacion', `Evaluación de desempeño: ${Number(x.nota_final).toFixed(2)} · ${String(x.categoria || '').split(' —')[0]}`,
    [x.proceso, RECOM_L[x.recomendacion], x.evaluador ? `Evaluó ${nomProp(x.evaluador)}` : '', x.retro_fecha ? `Retroalimentación el ${fFecha(x.retro_fecha)}` : 'Sin retroalimentación registrada'].filter(Boolean).join(' · '))
  for (const x of b.antecedentes || []) add(x.fecha, 'antecedente', antL(x.tipo), x.motivo || '')
  for (const x of (b.horas_extra || []).filter(h => h.min_reg > 0)) add(x.hasta > hoyCL() ? hoyCL() : x.hasta, 'asistencia',
    `Horas extra de ${mesL(x.periodo)}${x.en_curso ? ' (en curso)' : ''}: ${fmtH(x.min_aut)} autorizadas de ${fmtH(x.min_reg)} registradas`,
    `${fFecha(x.desde)} al ${fFecha(x.hasta)} · ${x.dias_aut} de ${x.dias_reg} días autorizados${x.min_pend ? ` · ${fmtH(x.min_pend)} por validar` : ''} · ${x.en_curso ? 'período en curso' : x.liquidacion ? 'pagado en la liquidación' : 'por pagar'}`)
  for (const x of b.remuneraciones || []) add(finDeMes(x.periodo), 'remuneracion', `Liquidación de ${mesL(x.periodo)}`, `Líquido ${fmtCLP(x.liquido)} · haberes ${fmtCLP(x.haberes)}${x.dias != null ? ` · ${x.dias} días trabajados` : ''}`)
  return ev.sort((a, c) => (a.fecha < c.fecha ? 1 : a.fecha > c.fecha ? -1 : 0))
}

// Estado de un período de horas extra (corte del 26 al 25)
function estadoHE(x) {
  if (x.en_curso) return { t: 'En curso', c: '#175CD3' }
  if (x.periodo < '2026-08' && x.min_reg > 0 && !x.min_aut) return { t: 'Antes de la validación en el ERP', c: '#6E6E73' }
  if (x.liquidacion) {
    const dif = x.pagado != null && x.costo_aut != null && Math.abs(x.pagado - x.costo_aut) > Math.max(3000, x.costo_aut * 0.05)
    return dif ? { t: x.pagado > x.costo_aut ? 'Pagado más de lo autorizado' : 'Pagado menos de lo autorizado', c: '#B25E09' } : { t: 'Pagado', c: '#1E7A44' }
  }
  return { t: 'Por pagar', c: '#B25E09' }
}

function TablaHE({ filas, veRemu }) {
  if (!filas?.length) return <div style={{ padding: '14px 12px', fontSize: 12.5, color: 'var(--text-muted)' }}>Sin horas extra registradas en el período.</div>
  const tot = filas.reduce((s, x) => ({ dias_reg: s.dias_reg + x.dias_reg, min_reg: s.min_reg + x.min_reg, dias_aut: s.dias_aut + x.dias_aut, min_aut: s.min_aut + x.min_aut,
    min_pend: s.min_pend + x.min_pend, min_rech: s.min_rech + x.min_rech, costo_aut: s.costo_aut + (x.costo_aut || 0), pagado: s.pagado + (x.pagado || 0) }),
    { dias_reg: 0, min_reg: 0, dias_aut: 0, min_aut: 0, min_pend: 0, min_rech: 0, costo_aut: 0, pagado: 0 })
  const num = { ...td, textAlign: 'right', whiteSpace: 'nowrap' }
  const gris = v => v ? v : <span style={{ color: '#C7C7CC' }}>0</span>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          {['Período de pago', 'Días con HE', 'Horas registradas', 'Días autorizados', 'Horas autorizadas', 'Por validar', 'Rechazadas', ...(veRemu ? ['Autorizado', 'Pagado en liquidación'] : []), 'Estado']
            .map((h, i) => <th key={h} style={{ ...th, textAlign: i === 0 || h === 'Estado' ? 'left' : 'right' }}>{h}</th>)}
        </tr></thead>
        <tbody>
          {filas.map(x => {
            const e = estadoHE(x)
            return (
              <tr key={x.periodo} style={{ background: x.en_curso ? '#175CD308' : 'transparent' }}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}><strong>{mesL(x.periodo)}</strong> <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fFecha(x.desde).slice(0, 5)} al {fFecha(x.hasta).slice(0, 5)}</span></td>
                <td style={num}>{gris(x.dias_reg)}</td>
                <td style={num}>{x.min_reg ? fmtH(x.min_reg) : gris(0)}</td>
                <td style={num}>{gris(x.dias_aut)}</td>
                <td style={num}>{x.min_aut ? <strong>{fmtH(x.min_aut)}</strong> : gris(0)}</td>
                <td style={num}>{x.min_pend ? <strong style={{ color: '#B25E09' }}>{fmtH(x.min_pend)}</strong> : gris(0)}</td>
                <td style={num}>{x.min_rech ? fmtH(x.min_rech) : gris(0)}</td>
                {veRemu && <td style={num}>{x.costo_aut ? fmtCLP(x.costo_aut) : gris(0)}</td>}
                {veRemu && <td style={num}>{x.liquidacion ? fmtCLP(x.pagado) : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>}
                <td style={{ ...td, whiteSpace: 'nowrap' }}><span style={chip(e.c)}>{e.t}</span></td>
              </tr>
            )
          })}
          <tr style={{ background: 'var(--bg-card)' }}>
            <td style={{ ...td, fontWeight: 800 }}>Total</td>
            <td style={{ ...num, fontWeight: 800 }}>{tot.dias_reg}</td>
            <td style={{ ...num, fontWeight: 800 }}>{fmtH(tot.min_reg)}</td>
            <td style={{ ...num, fontWeight: 800 }}>{tot.dias_aut}</td>
            <td style={{ ...num, fontWeight: 800 }}>{fmtH(tot.min_aut)}</td>
            <td style={{ ...num, fontWeight: 800, color: tot.min_pend ? '#B25E09' : 'inherit' }}>{fmtH(tot.min_pend)}</td>
            <td style={{ ...num, fontWeight: 800 }}>{fmtH(tot.min_rech)}</td>
            {veRemu && <td style={{ ...num, fontWeight: 800 }}>{fmtCLP(tot.costo_aut)}</td>}
            {veRemu && <td style={{ ...num, fontWeight: 800 }}>{fmtCLP(tot.pagado)}</td>}
            <td style={td}></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function exportarBitacora(b, eventos) {
  const p = b.persona || {}
  const wb = XLSX.utils.book_new()
  const hoja = (nombre, filas) => { const ws = XLSX.utils.json_to_sheet(filas.length ? filas : [{ '': 'Sin registros' }]); ws['!cols'] = Object.keys(filas[0] || {}).map(k => /fecha|desde|hasta|ingreso|egreso|inicio|término/i.test(k) ? ANCHO_FECHA_XLS : { wch: Math.min(60, Math.max(12, k.length + 4)) }); XLSX.utils.book_append_sheet(wb, ws, nombre) }
  const a = b.asistencia || {}
  hoja('Resumen', [
    { Dato: 'Trabajador', Valor: nomProp(p.nombre) }, { Dato: 'RUT', Valor: p.rut || '' }, { Dato: 'Cargo', Valor: p.cargo || '' },
    { Dato: 'Sucursal', Valor: p.sucursal || '' }, { Dato: 'Jefatura', Valor: p.jefatura || '' },
    { Dato: 'Ingreso', Valor: fFecha(p.fecha_ingreso) }, { Dato: 'Egreso', Valor: p.fecha_egreso ? fFecha(p.fecha_egreso) : '' },
    { Dato: 'Período analizado', Valor: `${fFecha(b.periodo?.desde)} a ${fFecha(b.periodo?.hasta)}` },
    { Dato: 'Asistencia %', Valor: a.pct_asistencia ?? '' }, { Dato: 'Puntualidad %', Valor: a.pct_puntualidad ?? '' },
    { Dato: 'Jornadas evaluables', Valor: a.jornadas ?? 0 }, { Dato: 'Ausencias sin justificar', Valor: a.ausencias ?? 0 },
    { Dato: 'Atrasos', Valor: a.atrasos ?? 0 }, { Dato: 'Minutos de atraso', Valor: a.min_atraso ?? 0 },
    { Dato: 'Marcajes atípicos', Valor: a.atipicos ?? 0 }, { Dato: 'Días de licencia', Valor: a.licencia ?? 0 },
    { Dato: 'Días de permiso', Valor: a.permisos ?? 0 }, { Dato: 'Días de vacaciones', Valor: a.vacaciones ?? 0 },
    { Dato: 'Saldo de vacaciones', Valor: b.vacaciones?.saldo ?? '' },
  ])
  hoja('Bitácora', eventos.map(e => ({ Fecha: fechaExcel(e.fecha), Tema: CATS.find(c => c.k === e.cat)?.l || e.cat, Hecho: e.titulo, Detalle: e.det })))
  hoja('Asistencia mensual', (b.meses || []).map(m => ({ Mes: mesL(m.mes), Jornadas: m.jornadas, Trabajados: m.trabajados, Ausencias: m.ausencias, 'Asistencia %': m.pct_asistencia, 'Puntualidad %': m.pct_puntualidad, Atrasos: m.atrasos, 'Min. atraso': m.min_atraso, 'Marcajes atípicos': m.atipicos, Licencia: m.licencia, Permisos: m.permisos, Vacaciones: m.vacaciones })))
  hoja('Incidencias', (b.incidencias || []).map(i => ({ Fecha: fechaExcel(i.fecha), Tipo: i.tipo, Detalle: i.det || '', Turno: i.turno || '', 'Entrada esperada': i.esperada || '', 'Entrada real': i.entrada || '', 'Salida real': i.salida || '', Marcas: i.marcas ?? '', 'Min. atraso': i.min || 0 })))
  hoja('Permisos y ausencias', [
    ...(b.permisos || []).map(x => ({ Desde: fechaExcel(x.desde), Hasta: fechaExcel(x.hasta), Tipo: oracion(x.nombre), Clase: CLASE_L[x.clase] || x.clase, Detalle: x.comentario || '', Origen: 'Workera' })),
    ...(b.novedades || []).map(x => ({ Desde: fechaExcel(x.desde), Hasta: fechaExcel(x.hasta || x.desde), Tipo: CLASE_L[x.tipo] || x.tipo, Clase: CLASE_L[x.tipo] || x.tipo, Detalle: x.motivo || '', Origen: 'ERP' })),
    ...(b.ausencias || []).map(x => ({ Desde: fechaExcel(x.fecha), Hasta: fechaExcel(x.fecha), Tipo: 'Día sin marca', Clase: CLASE_L[x.clasificacion] || x.clasificacion, Detalle: x.justificacion || '', Origen: 'Jefatura' })),
  ])
  hoja('Evaluaciones', (b.evaluaciones || []).map(x => ({ Fecha: fechaExcel(x.fecha), Proceso: x.proceso, 'Nota final': x.nota_final, Técnica: x.nota_tecnica, Formal: x.nota_formal, Categoría: x.categoria, Recomendación: RECOM_L[x.recomendacion] || '', 'Plan de mejora': x.con_plan ? 'Sí' : 'No', Retroalimentación: x.retro_fecha ? fFecha(x.retro_fecha) : '', Evaluador: nomProp(x.evaluador) })))
  hoja('Antecedentes', (b.antecedentes || []).map(x => ({ Fecha: fechaExcel(x.fecha), Tipo: antL(x.tipo), Motivo: x.motivo })))
  hoja('Horas extra', (b.horas_extra || []).map(x => ({ 'Período de pago': mesL(x.periodo), Desde: fechaExcel(x.desde), Hasta: fechaExcel(x.hasta), Estado: estadoHE(x).t,
    'Días con HE': x.dias_reg, 'Horas registradas': +(x.min_reg / 60).toFixed(2), 'Días autorizados': x.dias_aut, 'Horas autorizadas': +(x.min_aut / 60).toFixed(2),
    'Horas por validar': +(x.min_pend / 60).toFixed(2), 'Horas rechazadas': +(x.min_rech / 60).toFixed(2),
    ...(b.ve_remuneracion ? { 'Autorizado $': x.costo_aut, 'Pagado en liquidación $': x.pagado } : {}) })))
  if (b.ve_remuneracion) hoja('Remuneraciones', (b.remuneraciones || []).map(x => ({ Mes: mesL(x.periodo), 'Días trabajados': x.dias, Haberes: x.haberes, Descuentos: x.descuentos, Líquido: x.liquido })))
  hoja('Ficha y contratos', [
    ...(b.contratos || []).map(c => ({ Fecha: fechaExcel(c.inicio), Hecho: `Contrato ${CONTRATO_L[c.tipo] || c.tipo}`, Detalle: [c.termino ? `Hasta ${fFecha(c.termino)}` : '', c.renovacion ? `Renovación ${c.renovacion}` : '', c.nota].filter(Boolean).join(' · ') })),
    ...(b.cambios_ficha || []).map(c => ({ Fecha: fechaExcel(c.fecha), Hecho: `Cambio de ${CAMPO_L[c.campo] || c.campo}`, Detalle: `${c.antes || '—'} → ${c.despues || '—'}` })),
  ])
  XLSX.writeFile(wb, `Bitacora_${nomProp(p.nombre).replace(/\s+/g, '_')}_${hoyCL()}.xlsx`)
}

function BitacoraTrabajador({ cod, cu, perIni, onVolver }) {
  const [per, setPer] = useState(['90d', 'mes', 'mes_ant'].includes(perIni) ? 'anio' : perIni)
  const [b, setB] = useState(null)
  const [carg, setCarg] = useState(true)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('bitacora')
  const [cats, setCats] = useState(() => new Set(CATS.map(c => c.k)))
  const [nuevo, setNuevo] = useState(null)       // antecedente en edición
  const [guard, setGuard] = useState(false)
  const r = useMemo(() => rango(per), [per])

  const cargar = useCallback(async () => {
    setCarg(true); setErr(null)
    const { data, error } = await supabase.rpc('fn_rrhh_bitacora', { p_cod: cod, p_desde: r.desde, p_hasta: r.hasta })
    if (error) setErr(error.message)
    else if (data?.error) setErr(data.error === 'sin_acceso' ? 'No tienes acceso a la bitácora de trabajadores.' : 'Trabajador no encontrado.')
    else setB(data)
    setCarg(false)
  }, [cod, r.desde, r.hasta])
  useEffect(() => { cargar() }, [cargar])

  const eventos = useMemo(() => b ? armarEventos(b) : [], [b])
  const visibles = useMemo(() => eventos.filter(e => cats.has(e.cat)), [eventos, cats])

  async function guardarAntecedente() {
    if (!nuevo?.fecha || nuevo.fecha > hoyCL()) { setErr('La fecha del antecedente no puede ser futura.'); return }
    if ((nuevo.motivo || '').trim().length < 10) { setErr('Describe el antecedente (mín. 10 caracteres).'); return }
    setGuard(true); setErr(null)
    const { error } = await supabase.from('rrhh_antecedentes').insert({ cod_contaline: cod, fecha: nuevo.fecha, tipo: nuevo.tipo, motivo: nuevo.motivo.trim(), registrado_por: cu?.id || null })
    setGuard(false)
    if (error) { setErr(/row-level security|violates/i.test(error.message) ? 'Solo Gestión de Personas puede registrar antecedentes.' : error.message); return }
    setNuevo(null); cargar()
  }

  if (carg && !b) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Cargando bitácora…</div>
  if (!b) return (
    <div>
      <button onClick={onVolver} style={btn}>&larr; Maestro de dotación</button>
      <div style={{ ...card, padding: 20, marginTop: 12, color: '#B42318' }}>{err || 'No se pudo cargar la bitácora.'}</div>
    </div>
  )

  const p = b.persona, a = b.asistencia || {}
  const ct = (b.contratos || [])[0]
  const vence = ct?.tipo === 'plazo_fijo' ? diasHasta(ct.termino) : null
  const ant = mesesEntre(p.fecha_ingreso, p.fecha_egreso || hoyCL())
  const ultEv = (b.evaluaciones || [])[0]
  const catEv = catDe(ultEv?.nota_final)
  const nAmon = (b.antecedentes || []).filter(x => x.tipo === 'amonestacion_verbal' || x.tipo === 'amonestacion_escrita').length
  const remu = b.remuneraciones || []
  const heAct = (b.horas_extra || []).find(x => x.en_curso) || (b.horas_extra || [])[0]
  const heAnt = (b.horas_extra || []).find(x => !x.en_curso && x.min_reg > 0)
  const tabs = [
    { k: 'bitacora', l: `Bitácora (${eventos.length})` }, { k: 'asistencia', l: 'Asistencia y marcaje' },
    { k: 'permisos', l: `Permisos y ausencias (${(b.permisos || []).length + (b.novedades || []).length + (b.ausencias || []).length})` },
    { k: 'evaluaciones', l: `Evaluaciones (${(b.evaluaciones || []).length})` }, { k: 'antecedentes', l: `Antecedentes (${(b.antecedentes || []).length})` },
    ...(b.ve_remuneracion ? [{ k: 'remuneraciones', l: `Remuneraciones (${remu.length})` }] : []),
    { k: 'ficha', l: 'Ficha y contratos' },
  ]
  const cFecha = (k, l = 'Fecha') => ({ k, l, w: 96, nw: true, r: f => fFecha(f[k]) })

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={onVolver} style={btn}>&larr; Maestro de dotación</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Período de asistencia y permisos</span>
          <select value={per} onChange={e => setPer(e.target.value)} style={inp}>{PERIODOS.map(x => <option key={x.k} value={x.k}>{x.l}</option>)}</select>
          <button onClick={() => exportarBitacora(b, eventos)} style={btnP}>Exportar a Excel</button>
        </div>
      </div>

      {err && <div style={{ ...card, borderColor: '#F3C5C0', background: '#FEF3F2', color: '#B42318', padding: '9px 14px', marginBottom: 12, fontSize: 12.5 }}>{err}</div>}

      <div style={{ ...card, padding: '14px 18px', marginBottom: 12, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ width: 52, height: 52, borderRadius: 26, background: NAVY, color: '#fff', fontSize: 17, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {String(p.nombre || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase()}
        </span>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: NAVY }}>
            {nomProp(p.nombre)}
            {!p.activo && <span style={{ ...chip('#6E6E73'), marginLeft: 8 }}>EGRESADO {p.fecha_egreso ? fFecha(p.fecha_egreso) : ''}</span>}
            {!p.evaluable && <span style={{ ...chip('#6E6E73'), marginLeft: 6 }}>NO EVALUABLE</span>}
            {p.exento_asistencia && <span style={{ ...chip('#175CD3'), marginLeft: 6 }} title={p.exento_motivo || ''}>SIN CONTROL DE ASISTENCIA</span>}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3 }}>
            {[p.rut, p.cargo || 'Sin cargo', p.sucursal, p.jefatura ? `Jefatura: ${p.jefatura}` : 'Sin jefatura en el organigrama'].filter(Boolean).join(' · ')}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
            Ingreso {fFecha(p.fecha_ingreso)} ({antigL(ant)}) · Contrato {ct ? (CONTRATO_L[ct.tipo] || ct.tipo).toLowerCase() : 'sin registro'}
            {ct?.termino && <> hasta el <strong style={{ color: vence != null && vence <= 30 ? '#B25E09' : 'inherit' }}>{fFecha(ct.termino)}</strong>{vence != null && vence >= 0 ? ` (en ${vence} días)` : vence != null ? ' (vencido)' : ''}</>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12, opacity: carg ? 0.5 : 1 }}>
        <Kpi l='Asistencia' v={a.pct_asistencia == null ? 's/d' : `${a.pct_asistencia}%`} s={`${a.trabajados || 0} de ${a.jornadas || 0} jornadas`} c={cPct(a.pct_asistencia)} />
        <Kpi l='Puntualidad' v={a.pct_puntualidad == null ? 's/d' : `${a.pct_puntualidad}%`} s={`${a.atrasos || 0} atrasos · ${a.min_atraso || 0} min`} c={cPct(a.pct_puntualidad)} />
        <Kpi l='Ausencias' v={a.ausencias || 0} s='sin justificar' c={a.ausencias ? '#B42318' : undefined} />
        <Kpi l='Marcaje' v={a.atipicos || 0} s={`atípicos · ${a.por_verificar || 0} por verificar`} c={a.por_verificar ? '#B25E09' : undefined} />
        <Kpi l='Licencias y permisos' v={(a.licencia || 0) + (a.permisos || 0)} s={`${a.licencia || 0} licencia · ${a.permisos || 0} permiso`} />
        <Kpi l={`Horas extra ${heAct ? mesL(heAct.periodo) : ''}`} v={heAct ? fmtH(heAct.min_aut) : '—'}
          s={heAct ? `autorizadas de ${fmtH(heAct.min_reg)} registradas${heAct.en_curso ? ' a la fecha' : ''}${heAnt ? ` · ${mesL(heAnt.periodo)}: ${fmtH(heAnt.min_aut)} de ${fmtH(heAnt.min_reg)}` : ''}` : 'Sin registros'}
          c={heAct?.min_pend ? '#B25E09' : undefined} />
        <Kpi l='Vacaciones' v={b.vacaciones?.saldo != null ? Number(b.vacaciones.saldo).toFixed(1) : 's/d'} s={`saldo · ${a.vacaciones || 0} días en el período`} />
        <Kpi l='Última evaluación' v={ultEv ? Number(ultEv.nota_final).toFixed(2) : '—'} s={ultEv ? `${catEv?.l} · ${fFecha(ultEv.fecha)}` : (p.evaluable ? 'Sin evaluar' : 'No evaluable')} c={catEv?.c} />
        <Kpi l='Amonestaciones' v={nAmon} s={`${(b.antecedentes || []).length} antecedentes en total`} c={nAmon ? '#B42318' : undefined} />
        {b.ve_remuneracion && <Kpi l='Último líquido' v={remu[0] ? fmtCLP(remu[0].liquido) : '—'} s={remu[0] ? mesL(remu[0].periodo) : 'Sin liquidaciones'} />}
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
        {tabs.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{ padding: '8px 13px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit',
            fontWeight: tab === t.k ? 700 : 500, color: tab === t.k ? NAVY : 'var(--text-muted)', borderBottom: `2px solid ${tab === t.k ? NAVY : 'transparent'}`, marginBottom: -1 }}>{t.l}</button>
        ))}
      </div>

      {tab === 'bitacora' && (
        <Seccion titulo='Bitácora' nota='Todos los hechos registrados, del más reciente al más antiguo'
          extra={<div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {CATS.filter(c => c.k !== 'remuneracion' || b.ve_remuneracion).map(c => {
              const on = cats.has(c.k), n = eventos.filter(e => e.cat === c.k).length
              return <button key={c.k} onClick={() => setCats(s => { const x = new Set(s); if (x.has(c.k)) x.delete(c.k); else x.add(c.k); return x })}
                style={{ ...chip(on ? c.c : '#8E8E93'), border: 'none', cursor: 'pointer', opacity: on ? 1 : 0.55, fontFamily: 'inherit' }}>{c.l} ({n})</button>
            })}
          </div>}>
          {visibles.length === 0 ? <div style={{ padding: 16, fontSize: 12.5, color: 'var(--text-muted)' }}>Sin hechos registrados para los temas seleccionados.</div> : (
            <div style={{ maxHeight: 620, overflowY: 'auto' }}>
              {visibles.map((e, i) => {
                const c = CATS.find(x => x.k === e.cat)
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '92px 168px 1fr', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border)', alignItems: 'baseline' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', color: e.fecha > hoyCL() ? '#B25E09' : 'var(--text)' }}>{fFecha(e.fecha)}</div>
                    <div><span style={chip(c?.c || '#6E6E73')}>{c?.l}</span></div>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{e.titulo}</div>
                      {e.det && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1, lineHeight: 1.45 }}>{e.det}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Seccion>
      )}

      {tab === 'asistencia' && (<>
        <Seccion titulo='Cumplimiento por mes' nota={`${fFecha(r.desde)} a ${fFecha(r.hasta)}`}>
          <Tabla filas={b.meses} cols={[
            { k: 'mes', l: 'Mes', r: f => mesL(f.mes), nw: true }, { k: 'jornadas', l: 'Jornadas', a: 'right' }, { k: 'trabajados', l: 'Trabajadas', a: 'right' },
            { k: 'ausencias', l: 'Ausencias', a: 'right', r: f => f.ausencias ? <strong style={{ color: '#B42318' }}>{f.ausencias}</strong> : 0 },
            { k: 'pct_asistencia', l: 'Asistencia', a: 'right', r: f => f.pct_asistencia == null ? 's/d' : <strong style={{ color: cPct(f.pct_asistencia) }}>{f.pct_asistencia}%</strong> },
            { k: 'pct_puntualidad', l: 'Puntualidad', a: 'right', r: f => f.pct_puntualidad == null ? 's/d' : <strong style={{ color: cPct(f.pct_puntualidad) }}>{f.pct_puntualidad}%</strong> },
            { k: 'atrasos', l: 'Atrasos', a: 'right' }, { k: 'min_atraso', l: 'Min. atraso', a: 'right' }, { k: 'atipicos', l: 'Marcaje atípico', a: 'right' },
            { k: 'licencia', l: 'Licencia', a: 'right' }, { k: 'permisos', l: 'Permisos', a: 'right' }, { k: 'vacaciones', l: 'Vacaciones', a: 'right' },
          ]} />
        </Seccion>
        <Seccion titulo='Horas extra por período de pago'
          nota='Corte del 26 al 25 · registradas en el reloj vs autorizadas por la jefatura en el ERP; en los períodos liquidados, lo autorizado es lo que corresponde pagar'>
          <TablaHE filas={b.horas_extra} veRemu={b.ve_remuneracion} />
        </Seccion>
        <Seccion titulo={`Incidencias de asistencia y marcaje (${(b.incidencias || []).length})`} nota='Ausencias, atrasos fuera de la tolerancia y marcajes atípicos'>
          <div style={{ maxHeight: 460, overflowY: 'auto' }}>
            <Tabla filas={b.incidencias} cols={[
              cFecha('fecha'),
              { k: 'tipo', l: 'Tipo', nw: true, r: f => <span style={{ fontWeight: 600, color: f.tipo === 'Atraso' ? '#B25E09' : f.tipo === 'Marcaje atípico' ? '#6E6E73' : '#B42318' }}>{f.tipo}</span> },
              { k: 'det', l: 'Detalle', r: f => f.det || '' }, { k: 'turno', l: 'Turno', nw: true, r: f => f.turno || '' },
              { k: 'esperada', l: 'Entrada esperada', a: 'right', r: f => f.esperada || '' }, { k: 'entrada', l: 'Entrada real', a: 'right', r: f => f.entrada || '—' },
              { k: 'salida', l: 'Salida real', a: 'right', r: f => f.salida || '—' }, { k: 'marcas', l: 'Marcas', a: 'right', r: f => f.marcas ?? '' },
              { k: 'min', l: 'Min. atraso', a: 'right', r: f => f.min ? f.min : '' },
            ]} />
          </div>
        </Seccion>
        {((b.validaciones || []).length > 0 || (b.correcciones_turno || []).length > 0) && (
          <Seccion titulo='Validaciones de marcaje y correcciones de turno'>
            <Tabla filas={[
              ...(b.validaciones || []).map(x => ({ fecha: x.fecha, hecho: x.decision === 'error_marcaje' ? 'Validado como error de marcaje' : 'Atraso confirmado', det: x.motivo })),
              ...(b.correcciones_turno || []).map(x => ({ fecha: x.fecha, hecho: `Turno corregido: ${x.de || '—'} → ${x.a || '—'}`, det: [x.motivo, x.estado].filter(Boolean).join(' · ') })),
            ].sort((x, y) => (x.fecha < y.fecha ? 1 : -1))} cols={[cFecha('fecha'), { k: 'hecho', l: 'Hecho', nw: true }, { k: 'det', l: 'Motivo' }]} />
          </Seccion>
        )}
      </>)}

      {tab === 'permisos' && (<>
        <Seccion titulo='Vacaciones' nota='Feriado legal'>
          {b.vacaciones ? (
            <div style={{ display: 'flex', gap: 26, padding: '12px 16px', flexWrap: 'wrap', fontSize: 12.5 }}>
              {[['Devengados', b.vacaciones.devengados], ['Tomados', b.vacaciones.tomados], ['Programados', b.vacaciones.programados], ['Saldo', b.vacaciones.saldo], ['Días por año', b.vacaciones.dias_por_anio], ['Progresivos', b.vacaciones.progresivos]].map(([l, v]) => (
                <div key={l}><div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{l}</div><div style={{ fontSize: 17, fontWeight: 800 }}>{v == null ? '—' : Number(v).toFixed(Number.isInteger(Number(v)) ? 0 : 2)}</div></div>
              ))}
            </div>
          ) : <div style={{ padding: 14, fontSize: 12.5, color: 'var(--text-muted)' }}>Sin cálculo de vacaciones para esta persona.</div>}
        </Seccion>
        <Seccion titulo={`Permisos, licencias y vacaciones registrados (${(b.permisos || []).length + (b.novedades || []).length})`} nota='Workera y novedades cargadas en el ERP'>
          <Tabla filas={[
            ...(b.permisos || []).map(x => ({ desde: x.desde, hasta: x.hasta, tipo: oracion(x.nombre), clase: x.clase, det: x.comentario, origen: 'Workera' })),
            ...(b.novedades || []).map(x => ({ desde: x.desde, hasta: x.hasta || x.desde, tipo: CLASE_L[x.tipo] || oracion(x.tipo), clase: x.tipo, det: x.motivo, origen: 'ERP' })),
          ].sort((x, y) => (x.desde < y.desde ? 1 : -1))} cols={[
            cFecha('desde', 'Desde'), cFecha('hasta', 'Hasta'), { k: 'tipo', l: 'Tipo' },
            { k: 'clase', l: 'Clase', nw: true, r: f => <span style={chip(f.clase === 'licencia_medica' ? '#6941C6' : f.clase === 'vacaciones' ? '#1E7A44' : f.clase === 'permiso_sin_goce' ? '#B25E09' : '#175CD3')}>{CLASE_L[f.clase] || f.clase}</span> },
            { k: 'det', l: 'Detalle', r: f => f.det || '' }, { k: 'origen', l: 'Origen', nw: true },
          ]} />
        </Seccion>
        <Seccion titulo={`Días sin marca clasificados por la jefatura (${(b.ausencias || []).length})`}>
          <Tabla filas={b.ausencias} cols={[
            cFecha('fecha'),
            { k: 'clasificacion', l: 'Clasificación', nw: true, r: f => <span style={chip(f.clasificacion === 'falta_injustificada' ? '#B42318' : '#175CD3')}>{CLASE_L[f.clasificacion] || f.clasificacion}{f.cuenta_trabajado ? ' · cuenta como trabajado' : ''}</span> },
            { k: 'justificacion', l: 'Justificación', r: f => f.justificacion || '' },
          ]} />
        </Seccion>
      </>)}

      {tab === 'evaluaciones' && (
        <Seccion titulo='Evaluaciones de desempeño' nota='Solo evaluaciones enviadas. El informe completo está en Desempeño.'>
          <Tabla filas={b.evaluaciones} vacio='Sin evaluaciones enviadas.' cols={[
            cFecha('fecha'), { k: 'proceso', l: 'Proceso' },
            { k: 'nota_final', l: 'Nota final', a: 'right', r: f => <strong style={{ color: catDe(f.nota_final)?.c }}>{Number(f.nota_final).toFixed(2)}</strong> },
            { k: 'nota_tecnica', l: 'Técnica', a: 'right', r: f => f.nota_tecnica == null ? '—' : Number(f.nota_tecnica).toFixed(2) },
            { k: 'nota_formal', l: 'Formal', a: 'right', r: f => f.nota_formal == null ? '—' : Number(f.nota_formal).toFixed(2) },
            { k: 'categoria', l: 'Categoría', r: f => String(f.categoria || '').split(' —')[0] },
            { k: 'recomendacion', l: 'Recomendación', r: f => <span style={{ color: f.recomendacion === 'no_continuidad' ? '#B42318' : 'inherit', fontWeight: f.recomendacion === 'no_continuidad' ? 700 : 400 }}>{RECOM_L[f.recomendacion] || '—'}</span> },
            { k: 'con_plan', l: 'Plan de mejora', r: f => f.con_plan ? `Sí${f.reevaluacion ? ` · reevaluar ${fFecha(f.reevaluacion)}` : ''}` : 'No' },
            { k: 'retro_fecha', l: 'Retroalimentación', r: f => f.retro_fecha ? fFecha(f.retro_fecha) : <span style={{ color: '#B25E09' }}>Pendiente</span> },
            { k: 'evaluador', l: 'Evaluó', r: f => nomProp(f.evaluador) },
          ]} />
        </Seccion>
      )}

      {tab === 'antecedentes' && (
        <Seccion titulo='Antecedentes y amonestaciones' nota='Registro de Gestión de Personas'
          extra={!nuevo && <button onClick={() => setNuevo({ fecha: hoyCL(), tipo: 'amonestacion_escrita', motivo: '' })} style={{ ...btn, padding: '4px 11px', fontSize: 12 }}>Registrar antecedente</button>}>
          {nuevo && (
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input type='date' value={nuevo.fecha} max={hoyCL()} onChange={e => setNuevo(n => ({ ...n, fecha: e.target.value }))} style={inp} />
                <select value={nuevo.tipo} onChange={e => setNuevo(n => ({ ...n, tipo: e.target.value }))} style={inp}>{TIPOS_ANT.map(t => <option key={t.k} value={t.k}>{t.l}</option>)}</select>
              </div>
              <textarea value={nuevo.motivo} onChange={e => setNuevo(n => ({ ...n, motivo: e.target.value }))} rows={3} spellCheck lang='es'
                placeholder='Hecho concreto y respaldo (documento, quién estuvo presente, compromiso acordado)' style={{ ...inp, resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => { setNuevo(null); setErr(null) }} disabled={guard} style={btn}>Cancelar</button>
                <button onClick={guardarAntecedente} disabled={guard} style={btnP}>{guard ? 'Guardando…' : 'Guardar'}</button>
              </div>
            </div>
          )}
          <Tabla filas={b.antecedentes} vacio='Sin antecedentes registrados.' cols={[
            cFecha('fecha'),
            { k: 'tipo', l: 'Tipo', nw: true, r: f => <span style={chip(f.tipo === 'amonestacion_escrita' ? '#B42318' : f.tipo === 'amonestacion_verbal' ? '#B25E09' : f.tipo === 'reconocimiento' ? '#1E7A44' : '#175CD3')}>{antL(f.tipo)}</span> },
            { k: 'motivo', l: 'Motivo' },
          ]} />
        </Seccion>
      )}

      {tab === 'remuneraciones' && b.ve_remuneracion && (
        <Seccion titulo='Remuneraciones' nota='Liquidaciones cargadas en el ERP'>
          <Tabla filas={remu} vacio='Sin liquidaciones visibles para esta persona.' cols={[
            { k: 'periodo', l: 'Mes', nw: true, r: f => mesL(f.periodo) }, { k: 'dias', l: 'Días trabajados', a: 'right', r: f => f.dias ?? '—' },
            { k: 'haberes', l: 'Haberes', a: 'right', r: f => fmtCLP(f.haberes) }, { k: 'descuentos', l: 'Descuentos', a: 'right', r: f => fmtCLP(f.descuentos) },
            { k: 'liquido', l: 'Líquido', a: 'right', r: f => <strong>{fmtCLP(f.liquido)}</strong> }, { k: 'cargo', l: 'Cargo en la liquidación', r: f => f.cargo || '' },
          ]} />
          {remu.length > 1 && (
            <div style={{ padding: '9px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
              Promedio de {remu.length} meses: líquido {fmtCLP(remu.reduce((s, x) => s + Number(x.liquido || 0), 0) / remu.length)} · haberes {fmtCLP(remu.reduce((s, x) => s + Number(x.haberes || 0), 0) / remu.length)}
            </div>
          )}
        </Seccion>
      )}

      {tab === 'ficha' && (<>
        <Seccion titulo='Contratos'>
          <Tabla filas={b.contratos} vacio='Sin contratos registrados en Contratos y plazos.' cols={[
            { k: 'tipo', l: 'Tipo', nw: true, r: f => CONTRATO_L[f.tipo] || f.tipo }, cFecha('inicio', 'Inicio'), { k: 'termino', l: 'Término', nw: true, r: f => f.termino ? fFecha(f.termino) : 'Sin término' },
            { k: 'renovacion', l: 'Renovación', a: 'right', r: f => f.renovacion || 0 }, { k: 'nota', l: 'Nota', r: f => f.nota || '' },
          ]} />
        </Seccion>
        <Seccion titulo={`Cambios en la ficha (${(b.cambios_ficha || []).length})`} nota='El historial parte el 01-10-2026'>
          <Tabla filas={b.cambios_ficha} vacio='Sin cambios registrados.' cols={[
            cFecha('fecha'), { k: 'campo', l: 'Dato', nw: true, r: f => CAMPO_L[f.campo] || f.campo },
            { k: 'antes', l: 'Antes', r: f => f.antes || '—' }, { k: 'despues', l: 'Después', r: f => f.despues || '—' }, { k: 'origen', l: 'Origen', r: f => f.origen || '' },
          ]} />
        </Seccion>
      </>)}
    </div>
  )
}
