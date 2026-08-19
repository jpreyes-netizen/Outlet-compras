// src/procesos/prcUI.jsx — helpers y componentes compartidos del módulo Procesos
import { useState } from 'react'

/* ── helpers ─────────────────────────────────────────────────────────────── */
export const hoy = () => new Date().toISOString().slice(0, 10)
export const hora = () => new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
export const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
export const fN = n => new Intl.NumberFormat('es-CL').format(Math.round(n || 0))
export const pct = v => Math.round(v || 0) + '%'
export const fFecha = d => { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}-${m}-${y}` }
export const diasDesde = d => d ? Math.round((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000) : null

// Etiquetas cortas para los selectores en línea de la matriz
export const ESTADO_CORTO = {
  NO_EXISTE: 'No existe', BORRADOR: 'Borrador', EXISTE_PARCIAL: 'Parcial',
  EXISTE_COMPLETO: 'Completo', POR_OFICIALIZAR: 'Por oficializar', VIGENTE: 'Vigente', DEROGADO: 'Derogado'
}

export const SEMAFORO = {
  rojo:  { c: 'var(--danger)',  bg: 'var(--danger-bg)',  l: 'En riesgo' },
  ambar: { c: 'var(--warning)', bg: 'var(--warning-bg)', l: 'Atrasado' },
  verde: { c: 'var(--success)', bg: 'var(--success-bg)', l: 'Al día' },
  gris:  { c: 'var(--text-muted)', bg: 'var(--bg-page)',  l: 'Sin alerta' }
}

export const ROLES = [
  { k: 'admin',            l: 'Admin',              c: 'var(--danger)' },
  { k: 'dir_general',      l: 'Dir. General',       c: 'var(--danger)' },
  { k: 'dir_finanzas',     l: 'Dir. Finanzas',      c: 'var(--purple)' },
  { k: 'dir_negocios',     l: 'Dir. Negocios',      c: 'var(--accent)' },
  { k: 'dir_operaciones',  l: 'Dir. Operaciones',   c: 'var(--info)' },
  { k: 'jefe_operaciones', l: 'Jefe Operaciones',   c: 'var(--warning)' },
  { k: 'jefe_bodega',      l: 'Jefe Bodega',        c: 'var(--warning)' },
  { k: 'jefe_tienda',      l: 'Jefe Tienda',        c: 'var(--warning)' },
  { k: 'analista',         l: 'Analista',           c: 'var(--success)' },
  { k: 'directorio',       l: 'Directorio',         c: 'var(--text-muted)' }
]
export const rl = u => ROLES.find(r => r.k === u?.rol) || ROLES[8]

// Quién puede aprobar un SOP: dirección general, admin y los directores de área.
const APRUEBAN = ['admin', 'dir_general', 'dir_finanzas', 'dir_negocios', 'dir_operaciones']
const EDITAN = [...APRUEBAN, 'jefe_operaciones', 'jefe_bodega', 'jefe_tienda', 'analista']
export const puedeAprobar = u => APRUEBAN.includes(u?.rol)
export const puedeEditar  = u => EDITAN.includes(u?.rol)
export const esSoloLectura = u => u?.rol === 'directorio'

/* ── estilos base ────────────────────────────────────────────────────────── */
export const css = {
  input: {
    width: '100%', padding: '9px 11px', borderRadius: 9, fontSize: 13,
    border: '1px solid var(--border-2)', background: 'var(--bg-surface)',
    color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box'
  },
  select: {
    padding: '7px 10px', borderRadius: 9, fontSize: 12.5, fontWeight: 500,
    border: '1px solid var(--border-2)', background: 'var(--bg-surface)',
    color: 'var(--text-primary)', cursor: 'pointer', outline: 'none'
  },
  card: {
    background: 'var(--bg-surface)', borderRadius: 14, padding: 16,
    border: '1px solid var(--border-1)', boxSizing: 'border-box'
  },
  th: {
    padding: '9px 10px', fontSize: 10.5, fontWeight: 700, textAlign: 'left',
    color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: .3,
    borderBottom: '2px solid var(--border-2)', whiteSpace: 'nowrap', background: 'var(--bg-page)'
  },
  td: { padding: '9px 10px', fontSize: 12.5, borderBottom: '1px solid var(--border-1)', verticalAlign: 'top' }
}

/* ── componentes ─────────────────────────────────────────────────────────── */
export function Bt({ children, onClick, v = 'pri', dis, sm, style, title, type }) {
  const base = {
    padding: sm ? '6px 11px' : '9px 16px', borderRadius: 9, fontSize: sm ? 12 : 13,
    fontWeight: 600, cursor: dis ? 'not-allowed' : 'pointer', border: '1px solid transparent',
    opacity: dis ? .5 : 1, transition: 'filter .15s', whiteSpace: 'nowrap',
    minHeight: sm ? 30 : 38   // anula el min-height 44px global de theme.css
  }
  const vs = {
    pri:   { background: 'var(--accent)', color: '#fff' },
    sec:   { background: 'var(--bg-surface)', color: 'var(--text-primary)', borderColor: 'var(--border-2)' },
    ghost: { background: 'transparent', color: 'var(--text-secondary)' },
    ok:    { background: 'var(--success)', color: '#fff' },
    dan:   { background: 'var(--danger)', color: '#fff' },
    warn:  { background: 'var(--warning)', color: '#fff' }
  }
  return <button type={type || 'button'} title={title} onClick={dis ? undefined : onClick} disabled={dis}
    style={{ ...base, ...vs[v], ...style }}>{children}</button>
}

export function Bd({ children, c = 'var(--text-muted)', bg, style }) {
  return <span style={{
    display: 'inline-block', padding: '2px 8px', borderRadius: 7, fontSize: 10.5,
    fontWeight: 700, color: c, background: bg || `color-mix(in srgb, ${c} 14%, transparent)`,
    whiteSpace: 'nowrap', ...style
  }}>{children}</span>
}

export function Cd({ children, style, accent }) {
  return <div style={{ ...css.card, ...(accent ? { borderLeft: `3px solid ${accent}` } : {}), ...style }}>{children}</div>
}

export function Mt({ l, v, sub, c, onClick }) {
  return (
    <div onClick={onClick} style={{
      ...css.card, padding: '13px 15px', cursor: onClick ? 'pointer' : 'default'
    }}>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: .3 }}>{l}</div>
      <div style={{ fontSize: 25, fontWeight: 800, color: c || 'var(--text-primary)', lineHeight: 1.15, marginTop: 3 }}>{v}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export function Barra({ v, c = 'var(--accent)', h = 7, label }) {
  return (
    <div>
      {label && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 3 }}>
        <span>{label}</span><span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{pct(v)}</span>
      </div>}
      <div style={{ height: h, background: 'var(--bg-page)', borderRadius: h / 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: Math.max(0, Math.min(100, v || 0)) + '%', background: c, borderRadius: h / 2, transition: 'width .4s' }} />
      </div>
    </div>
  )
}

export function Sheet({ open, onClose, title, children, ancho = 620 }) {
  if (!open) return null
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,.42)', zIndex: 900,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 24, overflowY: 'auto'
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-surface)', borderRadius: 16, width: '100%', maxWidth: ancho,
        marginTop: 40, boxShadow: '0 20px 60px rgba(0,0,0,.25)', overflow: 'hidden'
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--border-1)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  )
}

export function Vacio({ txt, ic = '—' }) {
  return <div style={{ textAlign: 'center', padding: '34px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
    <div style={{ fontSize: 22, marginBottom: 6 }}>{ic}</div>{txt}
  </div>
}

/* Cuatro criterios del estado IMPLEMENTADO */
export function Criterios({ p, compacto }) {
  const items = [
    { k: 'sop_aprobado',    l: 'SOP aprobado y vigente', s: 'S' },
    { k: 'flujograma_ok',   l: 'Flujograma vigente',     s: 'F' },
    { k: 'capacitacion_ok', l: 'Capacitación registrada',s: 'C' },
    { k: 'medicion_ok',     l: 'Medición de KPI',        s: 'M' }
  ]
  return (
    <div style={{ display: 'flex', gap: compacto ? 3 : 8, flexWrap: compacto ? 'nowrap' : 'wrap' }}>
      {items.map(i => {
        const ok = !!p?.[i.k]
        return <span key={i.k} title={`${i.l}: ${ok ? 'cumple' : 'pendiente'}`} style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: compacto ? 0 : 4,
          width: compacto ? 20 : 'auto', height: compacto ? 20 : 'auto',
          padding: compacto ? 0 : '3px 9px', borderRadius: compacto ? 6 : 7,
          fontSize: compacto ? 10.5 : 11, fontWeight: 700,
          color: ok ? 'var(--success-text)' : 'var(--text-muted)',
          background: ok ? 'var(--success-bg)' : 'var(--bg-page)',
          border: `1px solid ${ok ? 'var(--success-bg)' : 'var(--border-1)'}`
        }}>{compacto ? i.s : (ok ? '✓ ' : '○ ') + i.l}</span>
      })}
    </div>
  )
}

export function descargar(nombre, contenido, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([contenido], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nombre
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

/* Render mínimo de markdown para el visor de SOP: encabezados, tablas, listas,
   citas y negritas. Suficiente para el formato SOP V2.0, sin dependencias. */
export function Markdown({ md }) {
  if (!md) return <Vacio txt="Sin contenido" />
  const lineas = String(md).split('\n')
  const out = []
  let i = 0, key = 0
  const inline = t => {
    const parts = String(t).split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|<br\/>)/g)
    return parts.map((p, k) => {
      if (/^\*\*.+\*\*$/.test(p)) return <strong key={k}>{p.slice(2, -2)}</strong>
      if (/^\*[^*]+\*$/.test(p)) return <em key={k} style={{ color: 'var(--text-muted)' }}>{p.slice(1, -1)}</em>
      if (/^`.+`$/.test(p)) return <code key={k} style={{ background: 'var(--bg-page)', padding: '1px 4px', borderRadius: 4, fontSize: '.92em' }}>{p.slice(1, -1)}</code>
      if (p === '<br/>') return <br key={k} />
      return <span key={k}>{p}</span>
    })
  }
  while (i < lineas.length) {
    const l = lineas[i]
    if (/^\|/.test(l) && /^\|[\s\-:|]+\|$/.test(lineas[i + 1] || '')) {
      const head = l.split('|').slice(1, -1).map(c => c.trim())
      i += 2
      const rows = []
      while (i < lineas.length && /^\|/.test(lineas[i])) { rows.push(lineas[i].split('|').slice(1, -1).map(c => c.trim())); i++ }
      out.push(
        <div key={key++} style={{ overflowX: 'auto', margin: '10px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            {head.some(Boolean) && <thead><tr>{head.map((h, k) => <th key={k} style={css.th}>{inline(h)}</th>)}</tr></thead>}
            <tbody>{rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} style={css.td}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ); continue
    }
    if (/^### /.test(l)) { out.push(<h4 key={key++} style={{ fontSize: 14, fontWeight: 700, margin: '18px 0 6px' }}>{inline(l.slice(4))}</h4>); i++; continue }
    if (/^## /.test(l))  { out.push(<h3 key={key++} style={{ fontSize: 15.5, fontWeight: 800, margin: '22px 0 8px', paddingBottom: 5, borderBottom: '1px solid var(--border-1)' }}>{inline(l.slice(3))}</h3>); i++; continue }
    if (/^# /.test(l))   { out.push(<h2 key={key++} style={{ fontSize: 19, fontWeight: 800, margin: '4px 0 12px' }}>{inline(l.slice(2))}</h2>); i++; continue }
    if (/^> /.test(l)) {
      const buf = []
      while (i < lineas.length && /^>/.test(lineas[i])) { buf.push(lineas[i].replace(/^>\s?/, '')); i++ }
      out.push(<div key={key++} style={{
        borderLeft: '3px solid var(--warning)', background: 'var(--warning-bg)',
        padding: '10px 14px', borderRadius: '0 10px 10px 0', margin: '12px 0', fontSize: 12.5, color: 'var(--warning-text)'
      }}>{buf.filter(Boolean).map((b, k) => <div key={k} style={{ fontWeight: /^#/.test(b) ? 800 : 400 }}>{inline(b.replace(/^#+\s*/, ''))}</div>)}</div>)
      continue
    }
    if (/^[-*] /.test(l)) {
      const buf = []
      while (i < lineas.length && /^[-*] /.test(lineas[i])) { buf.push(lineas[i].slice(2)); i++ }
      out.push(<ul key={key++} style={{ margin: '8px 0 8px 18px', fontSize: 13, lineHeight: 1.6 }}>{buf.map((b, k) => <li key={k}>{inline(b)}</li>)}</ul>)
      continue
    }
    if (/^---+$/.test(l)) { out.push(<hr key={key++} style={{ border: 0, borderTop: '1px solid var(--border-1)', margin: '16px 0' }} />); i++; continue }
    if (l.trim() === '') { i++; continue }
    out.push(<p key={key++} style={{ fontSize: 13, lineHeight: 1.65, margin: '7px 0' }}>{inline(l)}</p>); i++
  }
  return <div>{out}</div>
}

/* Selector de pestañas horizontal reutilizable */
export function Tabs({ tabs, val, onChange, sm }) {
  return (
    <div style={{ display: 'flex', gap: 4, overflowX: 'auto', borderBottom: '1px solid var(--border-1)' }}>
      {tabs.map(t => (
        <button key={t.k} onClick={() => onChange(t.k)} style={{
          padding: sm ? '9px 13px' : '13px 17px', border: 'none', background: 'transparent',
          borderBottom: `2.5px solid ${val === t.k ? 'var(--accent)' : 'transparent'}`,
          color: val === t.k ? 'var(--accent)' : 'var(--text-secondary)',
          fontSize: sm ? 12.5 : 13.5, fontWeight: val === t.k ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap'
        }}>{t.ic ? t.ic + ' ' : ''}{t.l}{t.n != null && <span style={{
          marginLeft: 6, fontSize: 10.5, fontWeight: 700, padding: '1px 6px', borderRadius: 6,
          background: 'var(--bg-page)', color: 'var(--text-muted)'
        }}>{t.n}</span>}</button>
      ))}
    </div>
  )
}

export function useToast() {
  const [msg, setMsg] = useState(null)
  const toast = (txt, tipo = 'ok') => { setMsg({ txt, tipo }); setTimeout(() => setMsg(null), 4200) }
  const Toast = () => msg ? (
    <div style={{
      position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', zIndex: 999,
      padding: '11px 18px', borderRadius: 11, fontSize: 13, fontWeight: 600, maxWidth: 620,
      background: msg.tipo === 'err' ? 'var(--danger)' : 'var(--success)', color: '#fff',
      boxShadow: '0 8px 26px rgba(0,0,0,.24)'
    }}>{msg.txt}</div>
  ) : null
  return { toast, Toast }
}
