// src/procesos/prcPersonas.jsx — las personas del módulo, en un solo lugar.
//
// Hasta ahora cada pantalla pedía el nombre de una persona con un input de
// texto libre. Resultado: la misma persona escrita de dos formas ("Rocío Jara"
// / "Rocio Jara"), conteos partidos y vistas de "lo mío" que mostraban la mitad.
//
// Acá viven el catálogo (v_prc_personas: usuarios del ERP con su carga real) y
// los dos controles que reemplazan al texto libre:
//   · SelPersona    — elegir UNA persona (líder, secretario, responsable)
//   · ChipsPersonas — armar una NÓMINA, viendo la disponibilidad de cada
//                     candidato frente al horario que se le va a asignar
//
// Ambos aceptan escribir un nombre que no está en el ERP (un externo, un
// cargo), pero lo marcan como tal: el dato queda, y se ve que es una excepción.

import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../supabase'
import { Bd, Hint, css } from './prcUI'
import { disponibilidad, etiquetaCarga, mismaPersona } from './prcComite'

const norm = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/** El catálogo de personas del ERP con su carga. Cae a `usuarios` si la vista no existe. */
export function usePersonas() {
  const [personas, setPersonas] = useState([])
  const [cargado, setCargado] = useState(false)
  useEffect(() => {
    let vivo = true
    supabase.from('v_prc_personas').select('*').then(async r => {
      let datos = r.error ? null : (r.data || [])
      if (datos == null) {
        const u = await supabase.from('usuarios').select('id, nombre, cargo, rol, correo').limit(300)
        datos = (u.data || []).map(x => ({ ...x, n_comites: 0, n_encargos: 0, lidera: 0, procesos_propios: 0 }))
      }
      if (!vivo) return
      setPersonas(datos.filter(p => p.nombre).sort((a, b) => a.nombre.localeCompare(b.nombre)))
      setCargado(true)
    })
    return () => { vivo = false }
  }, [])
  return { personas, cargado }
}

/** ¿Este nombre corresponde a alguien del catálogo? */
export const esDelErp = (nombre, personas) => (personas || []).some(p => mismaPersona(p.nombre, nombre))
export const personaDe = (nombre, personas) => (personas || []).find(p => mismaPersona(p.nombre, nombre)) || null

/** Descripción corta de una persona del catálogo: cargo si lo tiene, si no el rol. */
export const descPersona = p => p ? (p.cargo || ROL_LEGIBLE[p.rol] || p.rol || '') : ''

const ROL_LEGIBLE = {
  admin: 'Administrador', dir_general: 'Dirección General', dir_negocios: 'Dirección de Negocios',
  jefe_admin_finanzas: 'Jefatura de Adm. y Finanzas', jefe_tienda: 'Jefatura de Tienda',
  jefe_bodega: 'Jefatura de Bodega', operaciones: 'Operaciones', analista: 'Analista',
  postventa: 'Postventa', caja: 'Caja', cajero: 'Caja'
}

/* ═══════════════════════════════════════════════════════════════════════════
   SelPersona — elegir una persona
   ═══════════════════════════════════════════════════════════════════════════ */
export function SelPersona({ valor, onChange, personas = [], ctx, propuesta, ph = '— elegir persona —', permitirLibre = true, soloDeLista = [], dis }) {
  const [libre, setLibre] = useState(false)
  const lista = soloDeLista.length
    ? personas.filter(p => soloDeLista.some(n => mismaPersona(n, p.nombre)))
    : personas
  const fuera = valor && !esDelErp(valor, personas)

  useEffect(() => { if (fuera) setLibre(true) }, [fuera])

  const d = ctx && valor ? disponibilidad(valor, propuesta, ctx) : null

  if (libre) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input style={{ ...css.input, flex: 1 }} value={valor || ''} disabled={dis}
          placeholder="Nombre o cargo" onChange={e => onChange(e.target.value)} />
        <button type="button" onClick={() => { setLibre(false); onChange('') }}
          style={{ ...css.input, width: 'auto', cursor: 'pointer', padding: '0 10px' }} title="Volver a la lista del ERP">↩</button>
      </div>
      {valor && <Hint>No es un usuario del ERP: queda escrito tal cual.</Hint>}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <select style={css.select} value={valor || ''} disabled={dis}
        onChange={e => { if (e.target.value === '__libre__') { setLibre(true); onChange('') } else onChange(e.target.value) }}>
        <option value="">{ph}</option>
        {lista.map(p => (
          <option key={p.id || p.nombre} value={p.nombre}>
            {p.nombre}{descPersona(p) ? ` · ${descPersona(p)}` : ''}
            {p.n_comites || p.n_encargos ? ` — ${p.n_comites || 0} comité(s), ${p.n_encargos || 0} en curso` : ''}
          </option>
        ))}
        {permitirLibre && <option value="__libre__">✎ Otro (escribir un nombre o cargo)…</option>}
      </select>
      {d && (d.choques.length > 0 || d.lidera >= 2) && (
        <div style={{ fontSize: 11.5, color: 'var(--danger)', fontWeight: 600 }}>
          {d.choques.length > 0 && `⛔ ya tiene ${d.choques[0].codigo} a esa hora`}
          {d.lidera >= 2 && ` ⛔ ya lidera ${d.lidera} comités de trabajo (tope 2)`}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   ChipsPersonas — armar una nómina viendo la disponibilidad de cada candidato
   ═══════════════════════════════════════════════════════════════════════════ */
export function ChipsPersonas({ valores = [], onChange, personas = [], ctx, propuesta, fijos = [], maxSugeridos = 12 }) {
  const [q, setQ] = useState('')
  const [abierto, setAbierto] = useState(false)
  const caja = useRef(null)

  useEffect(() => {
    const fuera = e => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [])

  const quitar = n => onChange(valores.filter(x => !mismaPersona(x, n)))
  const sumar = n => {
    const v = String(n || '').trim()
    if (!v || valores.some(x => mismaPersona(x, v))) return
    onChange([...valores, v]); setQ('')
  }

  /* candidatos: los del ERP que no están en la nómina, ordenados por
     disponibilidad — primero quien está libre a esa hora, al final quien choca */
  const candidatos = useMemo(() => {
    const base = personas
      .filter(p => !valores.some(x => mismaPersona(x, p.nombre)))
      .filter(p => !q.trim() || norm(p.nombre).includes(norm(q)) || norm(descPersona(p)).includes(norm(q)))
      .map(p => ({ p, d: ctx ? disponibilidad(p.nombre, propuesta, ctx) : null }))
    return base.sort((a, b) => {
      const pa = (a.d?.choques.length ? 2 : a.d?.sobrecargada ? 1 : 0)
      const pb = (b.d?.choques.length ? 2 : b.d?.sobrecargada ? 1 : 0)
      return pa - pb || (a.d?.nComites || 0) - (b.d?.nComites || 0) || a.p.nombre.localeCompare(b.p.nombre)
    }).slice(0, maxSugeridos)
  }, [personas, valores, q, ctx, propuesta, maxSugeridos])

  return (
    <div ref={caja} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
        {valores.map(n => {
          const p = personaDe(n, personas)
          const fijo = fijos.some(f => mismaPersona(f, n))
          return (
            <span key={n} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '3px 9px', borderRadius: 999,
              background: p ? 'var(--accent-bg)' : 'var(--warning-bg)', color: p ? 'var(--accent)' : 'var(--warning-text)', fontWeight: 600
            }} title={p ? descPersona(p) : 'No es un usuario del ERP'}>
              {!p && '✎ '}{n}
              {!fijo && <span onClick={() => quitar(n)} style={{ cursor: 'pointer', opacity: .65, fontWeight: 700 }}>×</span>}
            </span>
          )
        })}
        {!valores.length && <Hint>Nadie todavía.</Hint>}
      </div>

      <input style={css.input} value={q} placeholder="Buscar persona del ERP, o escribir un nombre y Enter"
        onFocus={() => setAbierto(true)} onChange={e => { setQ(e.target.value); setAbierto(true) }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sumar(q) } }} />

      {abierto && candidatos.length > 0 && (
        <div style={{
          position: 'absolute', zIndex: 30, left: 0, right: 0, marginTop: 3, maxHeight: 260, overflowY: 'auto',
          background: 'var(--bg-surface)', border: '1px solid var(--accent)', borderRadius: 9, boxShadow: '0 8px 24px rgba(0,0,0,.12)'
        }}>
          {candidatos.map(({ p, d }) => (
            <div key={p.id || p.nombre} onClick={() => { sumar(p.nombre); setAbierto(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer', fontSize: 12.5, borderBottom: '1px solid var(--border)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-app)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span>{d?.choques.length ? '⛔' : d?.sobrecargada ? '⚠' : d?.libre ? '🟢' : '🔵'}</span>
              <b style={{ minWidth: 130 }}>{p.nombre}</b>
              <span style={{ color: 'var(--text-muted)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{descPersona(p)}</span>
              <span style={{ color: d?.choques.length ? 'var(--danger)' : 'var(--text-muted)', fontSize: 11.5, fontWeight: d?.choques.length ? 700 : 400 }}>
                {d?.choques.length ? `choca con ${d.choques[0].codigo}` : d ? etiquetaCarga(d) : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default { usePersonas, SelPersona, ChipsPersonas, esDelErp, personaDe, descPersona }
