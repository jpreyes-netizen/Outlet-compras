// src/core/responsive.js
// Hook centralizado para detección responsive
// Uso: const { isMobile, isTablet, isDesktop, w } = useResponsive()

import { useEffect, useState } from 'react'

// Breakpoints estándar (alineados con theme.css)
export const BREAKPOINTS = {
  xs: 480,   // móvil pequeño (iPhone SE)
  sm: 768,   // móvil/tablet límite
  md: 1024,  // tablet/desktop límite
  lg: 1280,  // desktop grande
}

// Hook principal: retorna estado responsive completo
export function useResponsive() {
  const [w, setW] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1024
  )
  const [h, setH] = useState(() =>
    typeof window !== 'undefined' ? window.innerHeight : 768
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => {
      setW(window.innerWidth)
      setH(window.innerHeight)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  return {
    w,
    h,
    isXs:      w < BREAKPOINTS.xs,
    isMobile:  w < BREAKPOINTS.sm,
    isTablet:  w >= BREAKPOINTS.sm && w < BREAKPOINTS.md,
    isDesktop: w >= BREAKPOINTS.md,
    isTouch:   typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0),
    isLandscape: w > h,
    isPortrait:  h > w,
  }
}

// Hook simplificado: solo isMobile (compatible con código existente)
export function useIsMobile() {
  const { isMobile } = useResponsive()
  return isMobile
}

// Detectar plataforma (útil para tweaks específicos iOS/Android)
export function getPlatform() {
  if (typeof window === 'undefined') return 'unknown'
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/Mac/.test(ua)) return 'mac'
  if (/Win/.test(ua)) return 'windows'
  return 'other'
}

// Detectar si es PWA standalone (app instalada)
export function isPWA() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true
}
