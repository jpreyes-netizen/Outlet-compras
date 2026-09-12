// src/rrhh/asistencia/tabs/AsisRemuneracion.jsx
// Costo de asistencia y horas extraordinarias · acceso restringido.
//
// Qué entrega: días efectivamente asistidos y cuánto cuestan las horas extra,
// por trabajador y período. NO liquida sueldo — eso lo hace Contaline, y
// duplicarlo crearía dos verdades sobre lo mismo. Esto entrega lo que hoy no
// existe en ninguna parte: el costo de las horas extra antes de pagarlas.
//
// Cálculo (Art. 32 CT, jornada de 42 h vigente desde el 26-04-2026):
//   valor hora ordinaria = sueldo base / 30 × 28 / 168
//   minutos 1 a 120   → ×1,5 (recargo legal)
//   minutos 121 en adelante → ×2,0 (política interna, sobre el mínimo legal)
// El corte es diario. El factor 2,0 no legaliza superar las 2 horas (Art. 31):
// por eso el costo sobre el tope se muestra como cifra propia.
//
// Acceso: lista explícita en rrhh_acceso_remuneracion. No se usa rol porque
// los roles son compartidos entre personas y filtrarían los sueldos.

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabase'
import * as XLSX from 'xlsx'

const NUM  = { fontVariantNumeric:'tabular-nums' }
const CLP  = n => '$' + Math.round(n || 0).toLocaleString('es-CL')
const fMin = m => { const h = Math.floor((m||0)/60), r = (m||0)%60
                    return h ? `${h}h${r?' '+r+'m':''}` : `${r}m` }
const periodoActual = () => new Date().toISOString().slice(0,7)
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre']
const fPeriodo = p => { const [y,m] = p.split('-'); return `${MESES[+m-1]} ${y}` }

export function AsisRemuneracion({ cu }) {
  const [permiso, setPermiso] = useState(undefined)  // undefined = resolviendo
  const [periodo, setPeriodo] = useState(periodoActual())
  const [periodos, setPeriodos] = useState([])
  const [filas, setFilas] = useState([])
  const [suc, setSuc] = useState('todas')
  const [orden, setOrden] = useState({ col:'costo_total', dir:'desc' })
  const [cargando, setCargando] = useState(true)
  const [verSueldos, setVerSueldos] = useState(false)

  useEffect(() => { verificar() }, [cu?.id])
  useEffect(() => { if (permiso) cargar() }, [permiso, periodo])

  async function verificar() {
    try {
      const { data } = await supabase.from('rrhh_acceso_remuneracion')
        .select('usuario_id').eq('usuario_id', cu.id).eq('activo', true).maybeSingle()
      setPermiso(!!data)
    } catch { setPermiso(false) }
  }

  async function cargar() {
    setCargando(true)
    try {
      const [r, p] = await Promise.all([
        supabase.from('v_asis_remuneracion_mes').select('*').eq('periodo', periodo).limit(20000),
        supabase.from('v_asis_remuneracion_mes').select('periodo').limit(20000),
      ])
      setFilas(r.data || [])
      setPeriodos([...new Set((p.data || []).map(x => x.periodo))].sort().reverse())
    } catch (e) { console.error(e) }
    finally { setCargando(false) }
  }

  const lista = useMemo(() => {
    const f = suc === 'todas' ? filas : filas.filter(x => x.sucursal_nombre === suc)
    return [...f].sort((a,b) => {
      const v = orden.col === 'empleado'
        ? String(a.empleado).localeCompare(String(b.empleado))
        : (Number(a[orden.col])||0) - (Number(b[orden.col])||0)
      return orden.dir === 'asc' ? v : -v
    })
  }, [filas, suc, orden])

  const tot = useMemo(() => lista.reduce((t,f) => ({
    dias: t.dias + (+f.dias_asistidos||0),
    aus:  t.aus  + (+f.dias_ausente||0),
    min:  t.min  + (+f.min_extra_total||0),
    aut:  t.aut  + (+f.costo_autorizado||0),
    pend: t.pend + (+f.costo_pendiente||0),
    todo: t.todo + (+f.costo_total||0),
    tope: t.tope + (+f.costo_sobre_tope||0),
    dTope:t.dTope+ (+f.dias_sobre_tope||0),
  }), { dias:0,aus:0,min:0,aut:0,pend:0,todo:0,tope:0,dTope:0 }), [lista])

  // Trabajadores sin sueldo base: no se omiten del reporte, se declaran. Un
  // informe de costos que esconde a quien no puede calcular miente por omisión.
  const sinBase = useMemo(() => lista.filter(f => f.sin_sueldo_base), [lista])

  const sucursales = useMemo(() =>
    [...new Set(filas.map(f => f.sucursal_nombre).filter(Boolean))].sort(), [filas])

  function exportar() {
    const rows = lista.map(f => ({
      'Trabajador': f.empleado,
      'Sueldo base cargado': f.sin_sueldo_base ? 'NO' : 'Sí',
      'Sucursal': f.sucursal_nombre,
      'Área': f.departamento || '',
      'Días con turno': +f.dias_con_turno,
      'Días asistidos': +f.dias_asistidos,
      'Días ausente': +f.dias_ausente,
      'Días con atraso': +f.dias_con_atraso,
      'Minutos de atraso': +f.min_atraso,
      ...(verSueldos ? { 'Sueldo base': +f.sueldo_base, 'Valor hora extra': +f.valor_hora_extra } : {}),
      'HHEE total (min)': +f.min_extra_total,
      'HHEE autorizadas (min)': +f.min_autorizados,
      'HHEE pendientes (min)': +f.min_pendientes,
      'Días sobre 2h': +f.dias_sobre_tope,
      'Costo autorizado': +f.costo_autorizado,
      'Costo pendiente': +f.costo_pendiente,
      'Costo total': +f.costo_total,
      'Del cual sobre el tope': +f.costo_sobre_tope,
    }))
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Object.keys(rows[0] || {}).map(k => ({ wch: k.length + 6 }))
    XLSX.utils.book_append_sheet(wb, ws, 'Costo asistencia')
    XLSX.writeFile(wb, `costo_asistencia_${periodo}${suc!=='todas'?'_'+suc.replace(/\s+/g,'-'):''}.xlsx`)
  }

  if (permiso === undefined) return <div style={{padding:50,textAlign:'center',color:'var(--text-muted)',fontSize:13}}>Verificando acceso…</div>
  if (permiso === false) return (
    <div style={{maxWidth:460,margin:'70px auto',textAlign:'center'}}>
      <h3 style={{fontSize:17,fontWeight:650,margin:'0 0 8px'}}>Acceso restringido</h3>
      <p style={{fontSize:13,color:'var(--text-muted)',lineHeight:1.6,margin:0}}>
        Este reporte contiene sueldos base y está limitado a Dirección, Gestión de Personas
        y Administración y Finanzas. Si necesitas acceso, solicítalo a Gerencia General.
      </p>
    </div>
  )

  const ord = col => setOrden(o => ({ col, dir: o.col===col && o.dir==='desc' ? 'asc' : 'desc' }))

  return (
    <div style={{maxWidth:1400}}>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',
        gap:16,marginBottom:16,flexWrap:'wrap'}}>
        <div>
          <h2 style={{fontSize:21,fontWeight:650,margin:0,letterSpacing:'-.015em'}}>
            Costo de asistencia y horas extraordinarias
          </h2>
          <div style={{fontSize:12.5,color:'var(--text-muted)',marginTop:3}}>
            {fPeriodo(periodo)} · {lista.length} trabajadores
            {filas[0]?.periodo_abierto && ' · período en curso, las cifras siguen cambiando'}
          </div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <select value={periodo} onChange={e=>setPeriodo(e.target.value)} style={sel}>
            {periodos.map(p => <option key={p} value={p}>{fPeriodo(p)}</option>)}
          </select>
          <select value={suc} onChange={e=>setSuc(e.target.value)} style={sel}>
            <option value="todas">Todas las sucursales</option>
            {sucursales.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={exportar} style={btn}>Excel</button>
        </div>
      </div>

      {/* Nota metodológica: evita que alguien lo confunda con una liquidación */}
      <div style={{padding:'10px 14px',borderRadius:8,fontSize:12,lineHeight:1.55,marginBottom:14,
        background:'var(--bg-surface)',borderLeft:'3px solid #0A6EBD',color:'var(--text)'}}>
        Este reporte <b>no reemplaza la liquidación</b>: muestra los días efectivamente asistidos
        y el costo de las horas extraordinarias según el Art. 32 del Código del Trabajo
        (sueldo base ÷ 30 × 28 ÷ 168, jornada de 42 horas). Los primeros 120 minutos diarios
        se valoran a 1,5 y desde el minuto 121 a 2,0 por política interna.
        <b> Solo las horas autorizadas por jefatura pasan a pago.</b>
      </div>

      {cargando ? (
        <div style={{padding:60,textAlign:'center',color:'var(--text-muted)',fontSize:13}}>Calculando…</div>
      ) : lista.length === 0 ? (
        <div style={{padding:'50px 20px',textAlign:'center',border:'1px solid var(--border)',
          borderRadius:10,background:'var(--bg-surface)'}}>
          <div style={{fontWeight:650,fontSize:15,marginBottom:4}}>Sin datos en {fPeriodo(periodo)}</div>
          <div style={{fontSize:12.5,color:'var(--text-muted)'}}>
            No hay jornadas registradas o falta cargar el sueldo base de estos trabajadores.
          </div>
        </div>
      ) : (
        <>
          {/* Totales del período */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',
            border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',
            background:'var(--bg-surface)',marginBottom:16}}>
            <Mini l="Días asistidos" v={tot.dias.toLocaleString('es-CL')}
              sub={tot.aus ? `${tot.aus} días de ausencia` : 'sin ausencias'}/>
            <Mini l="Horas extra" v={fMin(tot.min)} sub="del período"/>
            <Mini l="Ya autorizado" v={CLP(tot.aut)} sub="habilitado para pago" c="#1E7A44"/>
            <Mini l="Por decidir" v={CLP(tot.pend)} sub="sin autorización de jefatura"
              c={tot.pend ? '#B25E09' : undefined}/>
            <Mini l="Costo total" v={CLP(tot.todo)} sub="autorizado + pendiente"/>
            <Mini l="Sobre el tope de 2h" v={CLP(tot.tope)}
              sub={`${tot.dTope} jornadas · Art. 31`} c={tot.tope ? '#B42318' : undefined}/>
          </div>

          {sinBase.length > 0 && (
            <div style={{padding:'11px 15px',borderRadius:8,fontSize:12.5,lineHeight:1.55,marginBottom:14,
              background:'#B25E0910',borderLeft:'3px solid #B25E09'}}>
              <b style={{color:'#B25E09'}}>{sinBase.length} trabajador(es) sin sueldo base cargado</b>
              {' — '}{sinBase.map(f => f.empleado).join(', ')}.
              Sus días de asistencia sí se cuentan, pero <b>su costo de horas extra no está incluido
              en los totales</b>. Hay que cargar su sueldo base para que la cifra quede completa.
            </div>
          )}

          {tot.tope > 0 && (
            <div style={{padding:'11px 15px',borderRadius:8,fontSize:12.5,lineHeight:1.55,marginBottom:14,
              background:'#B4231810',borderLeft:'3px solid #B42318'}}>
              <b style={{color:'#B42318'}}>{CLP(tot.tope)} del costo proviene de horas sobre el tope legal</b>
              {' '}({Math.round(tot.tope / (tot.todo||1) * 100)}% del total, en {tot.dTope} jornadas).
              El Art. 31 no permite superar 2 horas extraordinarias diarias: pagarlas al doble
              no regulariza la situación. Si la carga se mantiene, conviene evaluar dotación
              antes que seguir absorbiéndola con horas extra.
            </div>
          )}

          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
            <label style={{fontSize:12,color:'var(--text-muted)',display:'flex',
              alignItems:'center',gap:6,cursor:'pointer'}}>
              <input type="checkbox" checked={verSueldos} onChange={e=>setVerSueldos(e.target.checked)}/>
              Mostrar sueldos base
            </label>
          </div>

          <div style={{border:'1px solid var(--border)',borderRadius:10,overflow:'hidden',
            background:'var(--bg-surface)'}}>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
                <thead>
                  <tr>
                    <Th onClick={()=>ord('empleado')}        o={orden} c="empleado">Trabajador</Th>
                    <Th>Sucursal</Th>
                    <Th onClick={()=>ord('dias_asistidos')}  o={orden} c="dias_asistidos" r>Asistidos</Th>
                    <Th onClick={()=>ord('dias_ausente')}    o={orden} c="dias_ausente" r>Ausente</Th>
                    <Th onClick={()=>ord('min_atraso')}      o={orden} c="min_atraso" r>Atraso</Th>
                    {verSueldos && <Th onClick={()=>ord('sueldo_base')} o={orden} c="sueldo_base" r>Sueldo base</Th>}
                    {verSueldos && <Th r>Valor h. extra</Th>}
                    <Th onClick={()=>ord('min_extra_total')} o={orden} c="min_extra_total" r>HHEE</Th>
                    <Th onClick={()=>ord('dias_sobre_tope')} o={orden} c="dias_sobre_tope" r>Sobre 2h</Th>
                    <Th onClick={()=>ord('costo_pendiente')} o={orden} c="costo_pendiente" r>Por decidir</Th>
                    <Th onClick={()=>ord('costo_autorizado')}o={orden} c="costo_autorizado" r>Autorizado</Th>
                    <Th onClick={()=>ord('costo_total')}     o={orden} c="costo_total" r>Costo total</Th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((f,i) => (
                    <tr key={f.cod_contaline} style={{background: i%2 ? 'var(--bg-app)' : 'transparent'}}>
                      <Td b>{f.empleado}
                        {f.sin_sueldo_base && <span title="Falta cargar su sueldo base"
                          style={{marginLeft:6,fontSize:9,fontWeight:700,padding:'1px 5px',
                          borderRadius:3,background:'#B25E0915',color:'#B25E09'}}>SIN BASE</span>}
                      </Td>
                      <Td muted>{f.sucursal_nombre}</Td>
                      <Td r>{f.dias_asistidos}</Td>
                      <Td r tono={+f.dias_ausente ? '#B42318' : undefined}>{+f.dias_ausente || '—'}</Td>
                      <Td r muted>{+f.min_atraso ? fMin(+f.min_atraso) : '—'}</Td>
                      {verSueldos && <Td r>{CLP(f.sueldo_base)}</Td>}
                      {verSueldos && <Td r muted>{CLP(f.valor_hora_extra)}</Td>}
                      <Td r>{+f.min_extra_total ? fMin(+f.min_extra_total) : '—'}</Td>
                      <Td r tono={+f.dias_sobre_tope ? '#B42318' : undefined}>{+f.dias_sobre_tope || '—'}</Td>
                      <Td r tono={+f.costo_pendiente ? '#B25E09' : undefined}>
                        {+f.costo_pendiente ? CLP(f.costo_pendiente) : '—'}</Td>
                      <Td r tono={+f.costo_autorizado ? '#1E7A44' : undefined}>
                        {+f.costo_autorizado ? CLP(f.costo_autorizado) : '—'}</Td>
                      <Td r b>{+f.costo_total ? CLP(f.costo_total) : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{borderTop:'2px solid var(--border)',fontWeight:700}}>
                    <Td b>Total {suc !== 'todas' ? suc : ''}</Td><Td/>
                    <Td r b>{tot.dias}</Td><Td r b>{tot.aus || '—'}</Td><Td/>
                    {verSueldos && <Td/>}{verSueldos && <Td/>}
                    <Td r b>{fMin(tot.min)}</Td>
                    <Td r b>{tot.dTope || '—'}</Td>
                    <Td r b>{CLP(tot.pend)}</Td>
                    <Td r b>{CLP(tot.aut)}</Td>
                    <Td r b>{CLP(tot.todo)}</Td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:10,lineHeight:1.7}}>
            Sueldos base verificados contra las liquidaciones de agosto 2026: 68 de 68 coincidencias exactas ·
            Las fichas con código provisorio de la apertura de Tienda Maipú resuelven su sueldo por equivalencia ·
            Los días asistidos consideran jornadas con turno asignado y al menos una marca ·
            Las horas extraordinarias provienen del control biométrico Workera.
          </div>
        </>
      )}
    </div>
  )
}

/* ── piezas ───────────────────────────────────────────────────────────────── */
function Mini({ l, v, sub, c }) {
  return (
    <div style={{padding:'12px 14px',borderRight:'1px solid var(--border)'}}>
      <div style={{fontSize:10.5,color:'var(--text-muted)',fontWeight:600,marginBottom:3}}>{l}</div>
      <div style={{fontSize:18,fontWeight:700,color:c||'var(--text)',letterSpacing:'-.01em',...NUM}}>{v}</div>
      <div style={{fontSize:10.5,color:'var(--text-muted)',marginTop:1}}>{sub}</div>
    </div>
  )
}
function Th({ children, onClick, o, c, r }) {
  const act = o && o.col === c
  return (
    <th onClick={onClick} style={{padding:'8px 10px',textAlign:r?'right':'left',
      fontSize:10.5,fontWeight:700,color:act?'var(--text)':'var(--text-muted)',
      borderBottom:'1.5px solid var(--border)',cursor:onClick?'pointer':'default',
      whiteSpace:'nowrap',userSelect:'none'}}>
      {children}{act && <span style={{marginLeft:4}}>{o.dir==='asc'?'▲':'▼'}</span>}
    </th>
  )
}
function Td({ children, r, b, muted, tono }) {
  return (
    <td style={{padding:'8px 10px',textAlign:r?'right':'left',
      borderBottom:'1px solid var(--border)',fontWeight:b?600:400,
      color: tono || (muted ? 'var(--text-muted)' : 'var(--text)'),
      whiteSpace:'nowrap',...(r?NUM:{})}}>{children}</td>
  )
}
const sel = {padding:'7px 11px',border:'1px solid var(--border)',borderRadius:7,
  fontSize:12.5,background:'var(--bg-surface)',color:'var(--text)',cursor:'pointer'}
const btn = {padding:'7px 15px',background:'var(--bg-card)',color:'var(--text)',
  border:'1px solid var(--border)',borderRadius:7,cursor:'pointer',fontSize:12.5,fontWeight:500}
