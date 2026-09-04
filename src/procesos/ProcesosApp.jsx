// src/procesos/ProcesosApp.jsx
// Módulo Procesos — matriz maestra, SOP versionados, flujogramas swimlane,
// firmas de aprobación y agenda de comités. Outlet de Puertas SpA.

import { useState, useEffect, useCallback } from 'react'
import { supabase, signOut } from '../supabase'
import { rl, useToast, Tabs, Bd } from './prcUI'
import { PrcDashboard } from './PrcDashboard'
import { PrcMatriz } from './PrcMatriz'
import { PrcFicha } from './PrcFicha'
import { PrcRepositorio } from './PrcRepositorio'
import { PrcComites } from './PrcComites'
import { PrcConfig } from './PrcConfig'
import { generarInforme } from './prcInforme'

const TABS = [
  { k: 'dashboard',   l: 'Dashboard',   ic: '📊' },
  { k: 'matriz',      l: 'Matriz',      ic: '🗂️' },
  { k: 'comites',     l: 'Comités',     ic: '🤝' },
  { k: 'repositorio', l: 'Repositorio', ic: '📁' },
  { k: 'config',      l: 'Config',      ic: '⚙️' }
]

export function ProcesosApp({ cu, setAppActual, onVolverHub, onCerrarSesion }) {
  // Convención del router del ERP: cada app recibe setAppActual.
  // setAppActual(null) devuelve al hub; onVolverHub queda como alternativa.
  const volverHub = onVolverHub || (typeof setAppActual === 'function' ? () => setAppActual(null) : null)
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('prc_tab') || 'dashboard' } catch { return 'dashboard' } })
  const [sel, setSel] = useState(null)          // proceso_id abierto en ficha
  const [matriz, setMatriz] = useState([])
  const [cat, setCat] = useState({ categorias: [], ondas: [], direcciones: [], estadosDoc: [], estadosImpl: [], comites: [], sistemas: [] })
  const [deps, setDeps] = useState([])
  const [alertas, setAlertas] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const { toast, Toast } = useToast()

  useEffect(() => { try { localStorage.setItem('prc_tab', tab) } catch {} }, [tab])

  // silencioso: refresca los datos sin mostrar el cartel de carga ni desmontar la
  // ficha abierta. Guardar dentro de la ficha usa este modo.
  const cargar = useCallback(async (silencioso) => {
    if (!silencioso) setLoading(true)
    setErr('')
    try {
      const [m, c, o, d, ed, ei, co, si, dp, al] = await Promise.all([
        supabase.from('v_prc_matriz').select('*').order('score', { ascending: false }).order('id'),
        supabase.from('prc_categorias').select('*').order('orden'),
        supabase.from('prc_ondas').select('*').order('orden'),
        supabase.from('prc_direcciones').select('*').order('orden'),
        supabase.from('prc_estados_doc').select('*').order('orden'),
        supabase.from('prc_estados_impl').select('*').order('orden'),
        supabase.from('prc_comites').select('*').order('orden'),
        supabase.from('prc_sistemas').select('*').order('orden'),
        supabase.from('prc_dependencias').select('*'),
        supabase.from('v_prc_alertas').select('*')
      ])
      if (m.error) throw m.error
      setMatriz(m.data || [])
      setCat({
        categorias: c.data || [], ondas: o.data || [], direcciones: d.data || [],
        estadosDoc: ed.data || [], estadosImpl: ei.data || [], comites: co.data || [], sistemas: si.data || []
      })
      setDeps(dp.data || [])
      setAlertas(al.data || [])
    } catch (e) {
      setErr('No se pudo cargar la matriz de procesos. ' + (e?.message || ''))
    } finally { if (!silencioso) setLoading(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const abrir = id => { setSel(id); window.scrollTo({ top: 0 }) }
  const cerrarFicha = (recargar) => { setSel(null); if (recargar) cargar() }

  const salir = async () => {
    if (typeof onCerrarSesion === 'function') return onCerrarSesion()
    try { await signOut() } catch {}
    window.location.reload()
  }

  const enRiesgo = matriz.filter(p => p.semaforo === 'rojo').length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)' }}>
      <header style={{
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-1)',
        padding: '13px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 60
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {volverHub && (
            <button onClick={volverHub} style={{
              padding: '7px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              border: '1px solid var(--border-2)', background: 'var(--bg-surface)', color: 'var(--text-secondary)'
            }}>← Apps</button>
          )}
          <div style={{ fontSize: 22 }}>🧭</div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>Procesos</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              Matriz maestra, SOP y flujogramas · Outlet de Puertas
            </div>
          </div>
          {enRiesgo > 0 && <Bd c="var(--danger)">{enRiesgo} en riesgo</Bd>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{cu?.nombre}</div>
            <div style={{ fontSize: 11, color: rl(cu).c, fontWeight: 600 }}>{rl(cu).l}</div>
          </div>
          <button onClick={salir} style={{
            padding: '7px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            border: 'none', background: 'transparent', color: 'var(--text-muted)'
          }}>Salir</button>
        </div>
      </header>

      {!sel && (
        <nav style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-1)', padding: '0 24px' }}>
          <Tabs tabs={TABS.map(t => t.k === 'matriz' ? { ...t, n: matriz.length } : t)} val={tab} onChange={setTab} />
        </nav>
      )}

      <main style={{ padding: '20px 24px 60px', maxWidth: sel ? 1500 : 1600, margin: '0 auto' }}>
        {err && (
          <div style={{
            padding: '11px 15px', borderRadius: 10, background: 'var(--danger-bg)',
            color: 'var(--danger-text)', fontSize: 13, marginBottom: 14
          }}>⚠ {err}</div>
        )}
        {loading && <div style={{ padding: 50, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Cargando matriz de procesos…</div>}

        {!loading && sel && (
          <PrcFicha id={sel} cu={cu} cat={cat} matriz={matriz} deps={deps} onCerrar={cerrarFicha}
            onRefrescarMatriz={() => cargar(true)} onAbrir={abrir} toast={toast} />
        )}
        {!loading && !sel && tab === 'dashboard'   && (
          <PrcDashboard matriz={matriz} cat={cat} alertas={alertas} onAbrir={abrir}
            onIrComites={vista => { try { localStorage.setItem('prc_vista_comite', vista) } catch {} setTab('comites') }}
            onInforme={() => generarInforme({ matriz, cat, cu, toast }).catch(e => toast('No se pudo generar el informe: ' + (e?.message || e), 'err'))} />
        )}
        {!loading && !sel && tab === 'matriz'      && <PrcMatriz matriz={matriz} cat={cat} cu={cu} onAbrir={abrir} onRecargar={cargar} toast={toast} />}
        {!loading && !sel && tab === 'comites'     && <PrcComites matriz={matriz} cat={cat} cu={cu} onAbrir={abrir} toast={toast} />}
        {!loading && !sel && tab === 'repositorio' && <PrcRepositorio matriz={matriz} cu={cu} onAbrir={abrir} toast={toast} />}
        {!loading && !sel && tab === 'config'      && <PrcConfig cat={cat} cu={cu} onRecargar={cargar} toast={toast} />}
      </main>
      <Toast />
    </div>
  )
}

export default ProcesosApp
