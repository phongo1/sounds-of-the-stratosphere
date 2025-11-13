import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DerivedObservation } from './useObservationStream'

type PlaybackOptions = {
  observations: DerivedObservation[]
  isPlaying: boolean
  speed: number
}

const MIN_DELAY_MS = 400
const MAX_DELAY_MS = 10000

export function useObservationPlayback({ observations, isPlaying, speed }: PlaybackOptions) {
  const [index, setIndex] = useState(0)
  const timerRef = useRef<number | null>(null)

  const safeSpeed = Math.max(0.25, speed)

  const clearTimer = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => {
    if (!observations.length) {
      setIndex(0)
      return
    }
    setIndex((current) => Math.min(current, observations.length - 1))
  }, [observations.length])

  useEffect(() => {
    if (!isPlaying || observations.length < 2) {
      clearTimer()
      return
    }

    const current = observations[index]
    const next = observations[index + 1]

    if (!next) {
      clearTimer()
      return
    }

    const delta = next.date.getTime() - current.date.getTime()
    const scaled = clamp(delta / safeSpeed, MIN_DELAY_MS, MAX_DELAY_MS)

    timerRef.current = window.setTimeout(() => {
      setIndex((prev) => Math.min(prev + 1, observations.length - 1))
    }, scaled)

    return clearTimer
  }, [index, isPlaying, observations, safeSpeed])

  useEffect(() => clearTimer, [])

  const progress = useMemo(() => {
    if (observations.length <= 1) return 0
    return index / (observations.length - 1)
  }, [index, observations.length])

  const setProgress = useCallback(
    (value: number) => {
      if (!observations.length) return
      const clamped = clamp(value, 0, 1)
      const nextIndex = Math.round(clamped * (observations.length - 1))
      setIndex(nextIndex)
    },
    [observations.length],
  )

  const stepBackward = useCallback(() => {
    setIndex((prev) => Math.max(0, prev - 1))
  }, [])

  const stepForward = useCallback(() => {
    if (!observations.length) return
    setIndex((prev) => Math.min(prev + 1, observations.length - 1))
  }, [observations.length])

  return {
    index,
    progress,
    setIndex,
    setProgress,
    stepBackward,
    stepForward,
    currentObservation: observations[index] ?? null,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
