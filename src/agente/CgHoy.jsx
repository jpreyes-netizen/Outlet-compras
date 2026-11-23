import { useState, useMemo } from 'react'
import {
  SEM, ESTADO_DIM, EJE, APP_NOMBRE, TRAMA, btnP, btnS, panelCaja,
  fmtValor, fmtMeta, fechaLarga, horaCL, hoyCL, sumarDias, nivel, cambiosSemana,
  Chip, ChipSit, Etiqueta, AsignarAccion
} from './cgComun'

/* ═══ Pestaña Hoy ═══
   La cabina del gerente. Responde, en este orden:
   1) ¿Cómo está la empresa?  2) ¿Qué atiendo primero y a quién se lo asigno?
   3) ¿Qué está en marcha y qué ya movió el indicador?
   Método semanal: revisa las prioridades → asigna dueño y fecha → verifica con datos. */

const tit = { fontSize: 13, fontWeight: 700, color: '#1C1C1E' }
const sub = { fontSize: 11.5, color: '#6B7280' }

function Paso({ n, titulo, detalle, color, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', cursor: onClick ? 'pointer' : 'default',
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: '9px 12px', fontFamily: 'inherit', minWidth: 0
    }}>
      <span style={{
        width: 22, height: 22, borderRadius: '50%', background: '#1C1C1E', color: '#fff', fontSize: 12, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
      }}>{n}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#1C1C1E' }}>{titulo}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: color || '#4B5563', fontWeight: color ? 600 : 400, marginTop: 1 }}>{detalle}</span>
      </span>
    </button>
  )
}

function TarjetaPrioridad({ p, rank, dimNom, onAsignar, onVer, onAbrir }) {
  const nv = nivel(p.prioridad)
  const persistente = p.dias_rojo_30 >= 3
  return (
    <div style={{ ...panelCaja, display: 'grid', gridTemplateColumns: '30px minmax(0,1fr)', borderLeft: `4px solid ${nv.c}` }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#1C1C1E', textAlign: 'center', paddingTop: 11 }}>{rank}</div>
      <div style={{ padding: '10px 12px 10px 2px', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <Etiqueta c={nv.c} bg="#fff">{nv.l}</Etiqueta>
          <Etiqueta>{dimNom[p.dimension] || p.dimension}</Etiqueta>
          <Etiqueta>{EJE[p.eje] || p.eje}</Etiqueta>
          {p.acciones_abiertas > 0 && <Etiqueta c="#1D4ED8" bg="#E8EEFD">En gestión, vence {fechaLarga(p.proxima_fecha)}</Etiqueta>}
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1C1C1E', marginTop: 5, lineHeight: 1.3 }}>{p.nombre}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#1C1C1E', fontVariantNumeric: 'tabular-nums' }}>{fmtValor(p.valor, p.unidad)}</span>
          <span style={{ fontSize: 12, color: '#4B5563' }}>meta {fmtMeta(p.meta, p.sentido, p.unidad) || 'por definir'}</span>
          <Chip s={p.semaforo} />
          {p.tendencia === 'empeora' && <span style={{ fontSize: 11.5, color: SEM.rojo.c, fontWeight: 600 }}>empeoró en 7 días</span>}
          {p.tendencia === 'mejora' && <span style={{ fontSize: 11.5, color: SEM.verde.c, fontWeight: 600 }}>mejoró en 7 días</span>}
          {persistente && <span style={{ fontSize: 11.5, color: '#4B5563' }}>en rojo {p.dias_rojo_30} de los últimos 30 días</span>}
        </div>
        {p.por_que && <div style={{ fontSize: 12.5, color: '#1F2937', marginTop: 6, lineHeight: 1.45 }}><b>Por qué importa.</b> {p.por_que}</div>}
        {p.accion_sugerida && <div style={{ fontSize: 12.5, color: '#1F2937', marginTop: 3, lineHeight: 1.45 }}><b>Primer paso.</b> {p.accion_sugerida}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#4B5563', marginRight: 'auto' }}>Dueño sugerido: <b style={{ color: '#1C1C1E' }}>{p.responsable || 'por asignar'}</b></span>
          <button onClick={onAsignar} style={btnP}>Asignar acción</button>
          <button onClick={onVer} style={btnS}>Ver indicador</button>
          {p.app_destino && APP_NOMBRE[p.app_destino] && <button onClick={onAbrir} style={btnS}>Abrir {APP_NOMBRE[p.app_destino]}</button>}
        </div>
      </div>
    </div>
  )
}

export function CgHoy({ datos, isMobile, irA, abrirApp, verFicha }) {
  const { dims, ult, hist, cat, dimNom, prioridades, acciones, usuarios, cargando, error, recargar } = datos
  const [verTodas, setVerTodas] = useState(false)
  const [conGestion, setConGestion] = useState(false)
  const [asignar, setAsignar] = useState(null)   // prioridad seleccionada
  const [aviso, setAviso] = useState(null)

  const hoy = hoyCL()
  const ultPorCod = useMemo(() => Object.fromEntries(ult.map(r => [r.codigo, r])), [ult])
  const abiertas = acciones.filter(a => a.estado !== 'completada')
  const vencidas = abiertas.filter(a => a.situacion === 'vencida')
  const listas = abiertas.filter(a => a.situacion === 'lista_para_cerrar')
  const sinAccion = prioridades.filter(p => !p.acciones_abiertas)
  const visibles = conGestion ? prioridades : sinAccion
  const lista = verTodas ? visibles : visibles.slice(0, 5)
  const rojos = ult.filter(r => r.semaforo === 'rojo').length
  const nSinMeta = Object.values(cat).filter(i => i.activo && i.meta == null && i.tolerancia_pct == null).length
  const cuenta = e => dims.filter(d => d.estado === e).length
  const ultimaMedicion = ult.reduce((mx, r) => (r.medido_at && (!mx || r.medido_at > mx)) ? r.medido_at : mx, null)
  const cambios = useMemo(() => cambiosSemana(hist), [hist])
  const primeraFecha = useMemo(() => {
    let min = null
    for (const pts of Object.values(hist)) if (pts[0] && (!min || pts[0].fecha_medicion < min)) min = pts[0].fecha_medicion
    return min ? String(min).slice(0, 10) : null
  }, [hist])

  const frase = [
    cuenta('rojo') && `${cuenta('rojo')} ${cuenta('rojo') === 1 ? 'dimensión en rojo' : 'dimensiones en rojo'}`,
    cuenta('no_evaluable') && `${cuenta('no_evaluable')} que no se ${cuenta('no_evaluable') === 1 ? 'puede' : 'pueden'} evaluar porque tienen datos en rojo`,
    cuenta('amarillo') && `${cuenta('amarillo')} en amarillo`,
    cuenta('verde') && `${cuenta('verde')} en verde`,
  ].filter(Boolean).join(', ')

  const accionesOrdenadas = useMemo(() => abiertas.slice().sort((a, b) =>
    ((b.situacion === 'vencida') - (a.situacion === 'vencida')) || String(a.fecha_vencimiento).localeCompare(String(b.fecha_vencimiento))
  ), [abiertas])

  const resumenDim = d => {
    const pr = prioridades.filter(p => p.dimension === d.dimension)
    if (d.estado === 'no_evaluable') {
      const dato = pr.filter(p => p.eje === 'dato' && p.semaforo === 'rojo').map(p => p.nombre)
      return 'Datos en rojo: ' + (dato.slice(0, 2).join('; ') || 'revisar')
    }
    const rr = pr.filter(p => p.semaforo === 'rojo')
    if (!rr.length) return pr.length ? `${pr.length} en amarillo` : 'Sin alertas'
    return `${rr.length} en rojo: ` + rr.slice(0, 2).map(p => p.nombre).join('; ')
  }

  const copiarResumen = async () => {
    const lineas = [
      `Control de Gestión, ${fechaLarga(hoy)}`,
      `La empresa hoy: ${frase || 'sin mediciones'}.`,
      `${rojos} indicadores en rojo; ${sinAccion.length} prioridades sin acción asignada.`,
      '', 'Prioridades:',
      ...visibles.slice(0, 5).map((p, i) => `${i + 1}. ${p.nombre}: ${fmtValor(p.valor, p.unidad, true)} (meta ${fmtMeta(p.meta, p.sentido, p.unidad) || 'por definir'}). ${p.accion_sugerida || ''} Dueño: ${p.responsable || 'por asignar'}.`),
    ]
    if (vencidas.length) lineas.push('', `Acciones vencidas (${vencidas.length}):`, ...vencidas.map(a => `- ${a.titulo} (${a.responsable || 'sin responsable'}, venció ${fechaLarga(a.fecha_vencimiento)})`))
    if (listas.length) lineas.push('', `Listas para cerrar (${listas.length}):`, ...listas.map(a => `- ${a.titulo} (${a.responsable || '—'})`))
    const texto = lineas.join('\n')
    try {
      await navigator.clipboard.writeText(texto)
      setAviso({ tipo: 'ok', txt: 'Resumen copiado. Pégalo en el correo o en el chat de la reunión.' })
    } catch {
      setAviso({ tipo: 'error', txt: 'El navegador no dejó copiar. Selecciona y copia el resumen desde el texto que aparece abajo.' , texto })
    }
  }

  if (error) {
    return (
      <div style={{ ...panelCaja, padding: 16, fontSize: 13, color: SEM.rojo.c }}>
        No se pudo cargar el panel: {error}
        <div style={{ marginTop: 10 }}><button onClick={recargar} style={btnS}>Reintentar</button></div>
      </div>
    )
  }
  if (cargando && !ult.length) return <div style={{ fontSize: 13, color: '#8E8E93', padding: '24px 4px' }}>Cargando el panel…</div>
  if (!ult.length) {
    return (
      <div style={{ ...panelCaja, padding: 16, fontSize: 13, color: '#374151' }}>
        Todavía no hay mediciones. La primera corre hoy a las 12:30; también puedes medir desde la pestaña Indicadores.
      </div>
    )
  }

  const prioSel = asignar ? asignar : null

  return (
    <div>
      {/* Panorama + método */}
      <div style={{ ...panelCaja, padding: '12px 14px', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1C1C1E', lineHeight: 1.35 }}>La empresa hoy: {frase || 'sin mediciones'}.</div>
            <div style={{ fontSize: 13, color: '#374151', marginTop: 3 }}>
              {rojos} indicadores en rojo{sinAccion.length ? `; ${sinAccion.length} sin acción asignada. Empieza por las prioridades de abajo.` : '; todos tienen una acción en marcha.'}
            </div>
            <div style={{ ...sub, marginTop: 3 }}>Medido {horaCL(ultimaMedicion)}.</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={copiarResumen} style={btnS}>Copiar resumen</button>
            <button onClick={recargar} disabled={cargando} style={btnS}>{cargando ? 'Actualizando…' : 'Actualizar'}</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0,1fr))', gap: 8, marginTop: 10 }}>
          <Paso n={1} titulo="Revisa las prioridades" detalle={`${sinAccion.length} sin acción asignada`} color={sinAccion.length ? SEM.rojo.c : SEM.verde.c} />
          <Paso n={2} titulo="Asigna dueño y fecha" detalle={`${abiertas.length} acciones abiertas, ${vencidas.length} vencidas`}
            color={vencidas.length ? SEM.rojo.c : null} onClick={() => irA('acciones', { filtro: vencidas.length ? 'vencidas' : 'abiertas' })} />
          <Paso n={3} titulo="Verifica con datos" detalle={`${listas.length} listas para cerrar porque el indicador volvió a verde`}
            color={listas.length ? SEM.verde.c : null} onClick={() => irA('acciones', { filtro: 'listas' })} />
        </div>
        {aviso && (
          <div role="status" style={{ marginTop: 10, fontSize: 12, padding: '6px 10px', borderRadius: 6, color: aviso.tipo === 'ok' ? SEM.verde.c : SEM.rojo.c, background: aviso.tipo === 'ok' ? SEM.verde.bg : SEM.rojo.bg }}>
            {aviso.txt}
            {aviso.texto && <textarea readOnly value={aviso.texto} style={{ display: 'block', width: '100%', minHeight: 120, marginTop: 6, fontSize: 12, fontFamily: 'inherit' }} />}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1.7fr) minmax(320px,1fr)', gap: 10, alignItems: 'start' }}>
        {/* Prioridades */}
        <section aria-label="Prioridades">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1C1C1E' }}>Prioridades</span>
            <span style={sub}>Ordenadas por gravedad, importancia, distancia a la meta y cuánto tiempo llevan en rojo.</span>
            <span style={{ flex: 1 }} />
            <label style={{ fontSize: 12, color: '#374151', display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={conGestion} onChange={e => setConGestion(e.target.checked)} /> Incluir las que ya están en gestión
            </label>
          </div>
          {lista.length === 0 && (
            <div style={{ ...panelCaja, padding: 14, fontSize: 13, color: '#374151' }}>
              {prioridades.length ? 'Todas las prioridades tienen una acción en marcha. Revisa su avance en Acciones.' : 'No hay indicadores en rojo ni en amarillo.'}
            </div>
          )}
          <div style={{ display: 'grid', gap: 8 }}>
            {lista.map((p, i) => (
              <TarjetaPrioridad key={p.codigo} p={p} rank={i + 1} dimNom={dimNom}
                onAsignar={() => setAsignar(p)}
                onVer={() => verFicha(p.codigo)}
                onAbrir={() => abrirApp(p.app_destino)} />
            ))}
          </div>
          {visibles.length > 5 && (
            <button onClick={() => setVerTodas(v => !v)} style={{ ...btnS, marginTop: 8, width: '100%' }}>
              {verTodas ? 'Ver solo las 5 primeras' : `Ver las ${visibles.length} prioridades`}
            </button>
          )}
        </section>

        {/* Columna derecha */}
        <div style={{ display: 'grid', gap: 10 }}>
          <section aria-label="Salud por dimensión" style={{ ...panelCaja, padding: '10px 12px' }}>
            <div style={{ ...tit, marginBottom: 6 }}>Salud por dimensión</div>
            {dims.map(d => {
              const est = ESTADO_DIM[d.estado] || ESTADO_DIM.sin_dato
              const noEval = d.estado === 'no_evaluable'
              return (
                <button key={d.dimension} onClick={() => irA('indicadores', { dim: d.dimension })} style={{
                  display: 'grid', gridTemplateColumns: '10px minmax(0,1fr) 34px', gap: 8, alignItems: 'center', width: '100%', textAlign: 'left',
                  background: noEval ? TRAMA : 'transparent', border: 'none', borderTop: '1px solid #F1F5F9', padding: '7px 4px', cursor: 'pointer', fontFamily: 'inherit'
                }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: est.c }} aria-hidden="true" />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#1C1C1E' }}>
                      {d.dimension_nombre} <span style={{ fontWeight: 600, color: est.c }}>{est.l}</span>
                    </span>
                    <span style={{ display: 'block', fontSize: 11.5, color: '#4B5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resumenDim(d)}</span>
                  </span>
                  <span title={noEval ? 'Nota referencial: hay datos en rojo' : 'Nota de la dimensión'} style={{ fontSize: 17, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: noEval ? '#94A3B8' : '#1C1C1E' }}>{d.nota ?? '—'}</span>
                </button>
              )
            })}
          </section>

          <section aria-label="Acciones" style={{ ...panelCaja, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span style={tit}>Acciones en marcha</span>
              <span style={sub}>{abiertas.length} abiertas</span>
              <span style={{ flex: 1 }} />
              {acciones.length > 0 && <button onClick={() => irA('acciones', { filtro: 'abiertas' })} style={{ ...btnS, padding: '3px 8px', fontSize: 11.5 }}>Ver todas</button>}
            </div>
            {abiertas.length === 0
              ? <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5 }}>Todavía no hay acciones. Asigna la primera desde una prioridad: queda como tarea en Proyectos con dueño y fecha.</div>
              : accionesOrdenadas.slice(0, 6).map(a => (
                <button key={a.tarea_id} onClick={() => irA('acciones', { sel: a.tarea_id, filtro: 'abiertas' })} style={{
                  display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderTop: '1px solid #F1F5F9', padding: '6px 2px', cursor: 'pointer', fontFamily: 'inherit'
                }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#1C1C1E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.titulo}</span>
                    <ChipSit s={a.situacion} />
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: '#6B7280', marginTop: 1 }}>{a.responsable || 'sin responsable'}, vence {fechaLarga(a.fecha_vencimiento)}</span>
                </button>
              ))}
          </section>

          <section aria-label="Cambios de la semana" style={{ ...panelCaja, padding: '10px 12px' }}>
            <div style={{ ...tit, marginBottom: 6 }}>Cambios en 7 días</div>
            {cambios.conSemana === 0
              ? <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5 }}>
                  Aparecen cuando haya una semana de mediciones{primeraFecha ? `, desde el ${fechaLarga(sumarDias(primeraFecha, 7))}` : ''}.
                </div>
              : (!cambios.mejoraron.length && !cambios.empeoraron.length)
                ? <div style={{ fontSize: 12, color: '#6B7280' }}>Ningún indicador cambió de semáforo esta semana.</div>
                : <>
                    {cambios.empeoraron.map(c => (
                      <div key={'e' + c.codigo} style={{ fontSize: 12, padding: '3px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ color: SEM.rojo.c, fontWeight: 700 }}>Empeoró</span>
                        <span style={{ color: '#1C1C1E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat[c.codigo]?.nombre || c.codigo}</span>
                      </div>
                    ))}
                    {cambios.mejoraron.map(c => (
                      <div key={'m' + c.codigo} style={{ fontSize: 12, padding: '3px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ color: SEM.verde.c, fontWeight: 700 }}>Mejoró</span>
                        <span style={{ color: '#1C1C1E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat[c.codigo]?.nombre || c.codigo}</span>
                      </div>
                    ))}
                  </>}
          </section>

          {nSinMeta > 0 && (
            <section aria-label="Indicadores sin meta" style={{ ...panelCaja, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#374151', flex: 1, lineHeight: 1.45 }}>
                <b>{nSinMeta} indicadores sin meta</b> se miden, pero no entran al semáforo ni a las prioridades.
              </span>
              <button onClick={() => irA('indicadores', { sinMeta: true })} style={btnS}>Definir metas</button>
            </section>
          )}
        </div>
      </div>

      {prioSel && cat[prioSel.codigo] && (
        <AsignarAccion ind={cat[prioSel.codigo]} u={ultPorCod[prioSel.codigo]} prioridad={prioSel.prioridad} usuarios={usuarios}
          onCerrar={() => setAsignar(null)}
          onCreada={async () => {
            setAsignar(null)
            setAviso({ tipo: 'ok', txt: `Acción creada sobre "${prioSel.nombre}". Ya está en Proyectos con dueño y fecha.` })
            await recargar()
          }} />
      )}
    </div>
  )
}
