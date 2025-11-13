import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import './App.css'
import BalloonScene from './components/BalloonScene'
import { useObservationStream, type DerivedObservation } from './hooks/useObservationStream'
import { useObservationPlayback } from './hooks/useObservationPlayback'
import { useBalloonSonifier } from './hooks/useBalloonSonifier'

const SPEED_MIN = 0.5
const SPEED_MAX = 8
const HOURS_IN_DAY = 24
const DURATION_PRESETS = [1, 3, 6, 12, 24]
const TIMELINE_TICKS = [0, 6, 12, 18, 24]

function App() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(2)
  const [windowStart, setWindowStart] = useState(0)
  const [windowDuration, setWindowDuration] = useState(HOURS_IN_DAY)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const [isDraggingTimeline, setIsDraggingTimeline] = useState(false)

  const sinceDate = useMemo(() => new Date(Date.now() - HOURS_IN_DAY * 60 * 60 * 1000), [])

  useEffect(() => {
    setWindowStart((prev) => Math.min(prev, Math.max(0, HOURS_IN_DAY - windowDuration)))
  }, [windowDuration])

  const windowEnd = useMemo(
    () => Math.min(windowStart + windowDuration, HOURS_IN_DAY),
    [windowStart, windowDuration],
  )

  const stream = useObservationStream({
    isActive: true,
    refreshMs: isPlaying ? 15000 : 45000,
    since: sinceDate,
    limit: 600,
  })

  const filteredObservations = useMemo(() => {
    if (!stream.observations.length) return []
    const startMs = sinceDate.getTime()
    const startHour = windowStart
    const endHour = windowEnd
    return stream.observations.filter((observation) => {
      const hoursFromStart = (observation.date.getTime() - startMs) / (60 * 60 * 1000)
      return hoursFromStart >= startHour && hoursFromStart <= endHour
    })
  }, [stream.observations, windowStart, windowEnd, sinceDate])

  const playback = useObservationPlayback({
    observations: filteredObservations,
    isPlaying,
    speed,
  })
  const { progress, setProgress } = playback

  const { initializeAudio, triggerObservation } = useBalloonSonifier()

  useEffect(() => {
    if (!isPlaying || !playback.currentObservation) return
    triggerObservation(playback.currentObservation)
  }, [isPlaying, playback.currentObservation, triggerObservation])

  const togglePlayback = async () => {
    if (!filteredObservations.length) return
    if (!isPlaying) await initializeAudio()
    setIsPlaying((prev) => !prev)
  }

  useEffect(() => {
    if (!filteredObservations.length) {
      setIsPlaying(false)
    }
  }, [filteredObservations.length])

  const statusLabel = useMemo(() => {
    switch (stream.status) {
      case 'loading':
        return 'Listening for the last 24 hours of telemetry…'
      case 'ready': {
        if (stream.error) {
          return stream.error
        }
        if (!filteredObservations.length) {
          return 'No observations in the selected hour window.'
        }
        return `Streaming ${filteredObservations.length} observations from the selected hours.`
      }
      case 'error':
        return stream.error ?? 'Unable to reach WindBorne.'
      default:
        return 'Standing by.'
    }
  }, [stream.status, stream.error, filteredObservations.length])

  const metrics = buildMetricCards(playback.currentObservation)
  const missionLabel = useMemo(() => {
    const missionId = playback.currentObservation?.missionId ?? stream.observations.at(0)?.missionId
    if (!missionId || missionId === 'unknown') return 'Mission: Global ambient mix'
    return `Mission: ${missionId}`
  }, [playback.currentObservation?.missionId, stream.observations])

  const windowLabels = useMemo(() => {
    return {
      start: formatHourLabel(windowStart, sinceDate),
      end: formatHourLabel(windowEnd, sinceDate),
    }
  }, [windowStart, windowEnd, sinceDate])

  const maxWindowStart = Math.max(0, HOURS_IN_DAY - windowDuration)
  useEffect(() => {
    setProgress(0)
  }, [windowStart, windowDuration, setProgress])

  const chunkStartPct = (windowStart / HOURS_IN_DAY) * 100
  const chunkEndPct = (windowEnd / HOURS_IN_DAY) * 100
  const chunkWidthPct = chunkEndPct - chunkStartPct
  const playbackMarkerPct = chunkStartPct + chunkWidthPct * progress
  const timelineStyle = {
    '--chunk-start': `${chunkStartPct}%`,
    '--chunk-end': `${chunkEndPct}%`,
    '--chunk-width': `${chunkWidthPct}%`,
    '--playback-pct': `${playbackMarkerPct}%`,
  } as CSSProperties

  const moveWindowToPosition = useCallback(
    (clientX: number) => {
      if (maxWindowStart <= 0 || !timelineRef.current) return
      const rect = timelineRef.current.getBoundingClientRect()
      const relative = (clientX - rect.left) / rect.width
      const centeredStart = relative * HOURS_IN_DAY - windowDuration / 2
      const clamped = Math.min(Math.max(Math.round(centeredStart), 0), maxWindowStart)
      setWindowStart(clamped)
    },
    [maxWindowStart, windowDuration],
  )

  const handleTimelinePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (maxWindowStart <= 0) return
      event.preventDefault()
      moveWindowToPosition(event.clientX)
      setIsDraggingTimeline(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [maxWindowStart, moveWindowToPosition],
  )

  const handleTimelinePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isDraggingTimeline) return
      moveWindowToPosition(event.clientX)
    },
    [isDraggingTimeline, moveWindowToPosition],
  )

  const handleTimelinePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isDraggingTimeline) return
      setIsDraggingTimeline(false)
      event.currentTarget.releasePointerCapture(event.pointerId)
    },
    [isDraggingTimeline],
  )

  return (
    <div className="stage">
      <div className="scene-wrap">
        <BalloonScene observation={playback.currentObservation} isPlaying={isPlaying} />
      </div>

      <div className="hud hud-top-left">
        <p className="eyebrow">Windborne x Tone.js</p>
        <h1>Sounds of the Stratosphere</h1>
        <p className="status-line">{statusLabel}</p>
        {stream.lastUpdated && <p className="status-line">Last sync · {formatRelative(stream.lastUpdated)}</p>}
        {playback.currentObservation && (
          <p className="status-line">Now playing · {formatTime(playback.currentObservation.date)}</p>
        )}
      </div>

      <div className="hud hud-bottom-left">
        <div className="mini-panel">
          <p className="play-copy">
            {windowLabels.start} → {windowLabels.end}
          </p>
          <button
            className="play-btn"
            type="button"
            onClick={togglePlayback}
            disabled={!filteredObservations.length}
          >
            {isPlaying ? 'Pause performance' : 'Play mission slice'}
          </button>
          <div className="speed-control">
            <label htmlFor="speed">Tempo {speed.toFixed(2)}x</label>
            <input
              id="speed"
              type="range"
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={0.25}
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
            />
          </div>
          <button type="button" className="ghost" onClick={() => stream.refresh()}>
            Sync latest
          </button>
        </div>

        <div className="mini-panel">
          <div className="duration-chips">
            {DURATION_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={preset === windowDuration ? 'chip active' : 'chip'}
                onClick={() => setWindowDuration(preset)}
              >
                {preset}h
              </button>
            ))}
          </div>
          <div
            className="timeline-track"
            ref={timelineRef}
            style={timelineStyle}
            onPointerDown={handleTimelinePointerDown}
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={handleTimelinePointerUp}
            onPointerLeave={handleTimelinePointerUp}
          >
            <div className="timeline-band" />
            <div className="timeline-chunk" />
            <div className="timeline-progress" />
          </div>
          <div className="timeline-scale">
            {TIMELINE_TICKS.map((tick) => (
              <span key={tick}>{formatTickLabel(tick)}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="hud hud-bottom-right">
        <div className="mini-panel metrics">
          <p className="mission-tag">{missionLabel}</p>
          <div className="metric-grid">
            {metrics.map((metric) => (
              <article key={metric.label} className="metric">
                <p className="metric-label">{metric.label}</p>
                <p className="metric-value">{metric.value}</p>
                <p className="metric-hint">{metric.hint}</p>
              </article>
            ))}
          </div>
          <div className="scrub-control">
            <label htmlFor="scrub">Scrub span</label>
            <input
              id="scrub"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={progress}
              onChange={(event) => setProgress(Number(event.target.value))}
              disabled={filteredObservations.length < 2}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function buildMetricCards(observation: DerivedObservation | null) {
  if (!observation) {
    return [
      { label: 'Altitude', value: '—', hint: 'meters' },
      { label: 'Temperature', value: '—', hint: '°C' },
      { label: 'Humidity', value: '—', hint: '% RH' },
      { label: 'Wind speed', value: '—', hint: 'm/s' },
    ]
  }

  return [
    {
      label: 'Altitude',
      value: `${observation.altitude.toFixed(0)} m`,
      hint: 'Pitch source',
    },
    {
      label: 'Temperature',
      value: `${observation.temperature.toFixed(1)} °C`,
      hint: 'Filter cutoff',
    },
    {
      label: 'Humidity',
      value: `${observation.humidity.toFixed(0)} %`,
      hint: 'Reverb wet',
    },
    {
      label: 'Wind speed',
      value: `${observation.windSpeed.toFixed(1)} m/s`,
      hint: 'Amplitude & LFO',
    },
  ]
}

const timeFormatter = new Intl.DateTimeFormat([], {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const hourFormatter = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' })

function formatHourLabel(hourValue: number, sinceDate: Date) {
  const date = new Date(sinceDate.getTime() + hourValue * 60 * 60 * 1000)
  return hourFormatter.format(date)
}

function formatTickLabel(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`
}

function formatTime(date: Date) {
  return timeFormatter.format(date)
}

function formatRelative(date: Date) {
  const delta = Date.now() - date.getTime()
  if (delta < 1000 * 60) return 'just now'
  if (delta < 1000 * 60 * 60) return `${Math.round(delta / (1000 * 60))} min ago`
  const hours = Math.round(delta / (1000 * 60 * 60))
  return `${hours}h ago`
}

export default App
