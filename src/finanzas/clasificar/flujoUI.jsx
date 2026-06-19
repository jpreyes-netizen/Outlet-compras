import { motion, useMotionValue, useSpring, animate } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

/* ═══ Piezas de UI con profundidad y movimiento (framer-motion) ═══
   Compartidas por ProyeccionCompromisosTab y AnalisisRiesgoTab para un
   tablero coherente. Solo presentación — no contienen lógica de negocio. */

// Contenedor raíz: entrada suave + contexto de perspectiva para el tilt 3D de los hijos.
export function MotionRoot({ children, style = {} }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      style={{ display: 'flex', flexDirection: 'column', gap: 14, perspective: 1400, ...style }}
    >
      {children}
    </motion.div>
  )
}

// Tarjeta con inclinación 3D real siguiendo el mouse + elevación al hover (efecto vidrio).
export function TiltCard({ children, style = {}, intensity = 7, glass = true }) {
  const ref = useRef(null)
  const rx = useSpring(0, { stiffness: 220, damping: 18 })
  const ry = useSpring(0, { stiffness: 220, damping: 18 })
  const onMove = e => {
    const el = ref.current; if (!el) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    ry.set(px * intensity); rx.set(-py * intensity)
  }
  const onLeave = () => { rx.set(0); ry.set(0) }
  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      style={{
        rotateX: rx, rotateY: ry, transformStyle: 'preserve-3d', transformPerspective: 900,
        borderRadius: 14,
        background: glass ? 'rgba(255,255,255,0.96)' : '#fff',
        backdropFilter: glass ? 'blur(10px)' : undefined,
        border: '1px solid rgba(255,255,255,0.7)',
        boxShadow: '0 8px 26px rgba(15,40,80,0.10), 0 1px 3px rgba(15,40,80,0.06)',
        ...style,
      }}
    >
      {children}
    </motion.div>
  )
}

// Panel con elevación + leve lift al hover, sin inclinación (seguro para tablas/contenedores anchos).
export function GlassPanel({ children, style = {} }) {
  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: '0 12px 30px rgba(15,40,80,0.12)' }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      style={{
        borderRadius: 14, background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.7)',
        boxShadow: '0 6px 22px rgba(15,40,80,0.08)', ...style,
      }}
    >
      {children}
    </motion.div>
  )
}

// Número con animación de conteo (count-up) al cambiar de valor.
export function AnimatedNumber({ value, format = n => Math.round(n || 0).toLocaleString('es-CL'), style }) {
  const [disp, setDisp] = useState(value || 0)
  const prev = useRef(value || 0)
  useEffect(() => {
    const controls = animate(prev.current, value || 0, {
      duration: 0.7, ease: 'easeOut', onUpdate: v => setDisp(v),
    })
    prev.current = value || 0
    return () => controls.stop()
  }, [value])
  return <span style={style}>{format(disp)}</span>
}
