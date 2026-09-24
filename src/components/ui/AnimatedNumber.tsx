import { useEffect, useRef, useState } from 'react'

const EASE_OUT_EXPO = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t))

export interface AnimatedNumberProps {
  value: number
  duration?: number
  format?: (value: number) => string
  className?: string
}

/** Counts up/down from the previous value to the new one. No-ops to an instant jump under prefers-reduced-motion. */
export function AnimatedNumber({ value, duration = 800, format, className }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const from = fromRef.current
    if (prefersReducedMotion || from === value) {
      setDisplay(value)
      fromRef.current = value
      return
    }

    const start = performance.now()
    function tick(now: number) {
      const elapsed = now - start
      const progress = Math.min(1, elapsed / duration)
      const eased = EASE_OUT_EXPO(progress)
      setDisplay(from + (value - from) * eased)
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = value
      }
    }
    frameRef.current = requestAnimationFrame(tick)

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [value, duration])

  return <span className={className}>{format ? format(display) : Math.round(display)}</span>
}
