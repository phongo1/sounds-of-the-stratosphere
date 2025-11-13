import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const API_URL = 'https://api.windbornesystems.com/data/v1/observations'

export type RawObservation = Record<string, unknown>

type ObservationsResponse = {
  observations?: RawObservation[]
  next_since?: number
  has_next_page?: boolean
}

export type DerivedObservation = {
  id: string
  missionId: string
  timestamp: string
  date: Date
  altitude: number
  temperature: number
  humidity: number
  speed_u: number
  speed_v: number
  windSpeed: number
}

type StreamStatus = 'idle' | 'loading' | 'ready' | 'error'

type UseObservationStreamOptions = {
  missionId?: string | null
  isActive?: boolean
  refreshMs?: number
  since?: Date
  limit?: number
}

export function useObservationStream({
  missionId,
  isActive = true,
  refreshMs = 30000,
  since,
  limit = 250,
}: UseObservationStreamOptions) {
  const [observations, setObservations] = useState<DerivedObservation[]>([])
  const [status, setStatus] = useState<StreamStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const lastTimestampRef = useRef<string | null>(null)
  const missionRef = useRef<string | null>(missionId ?? null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sinceRef = useRef<string>(defaultSinceIso(since))
  const cursorRef = useRef<number>(isoToSeconds(sinceRef.current))
  const hasDataRef = useRef(false)
  const authHeader = useRef(buildAuthHeader())

  const resetState = useCallback(() => {
    setObservations([])
    lastTimestampRef.current = null
    setLastUpdated(null)
    hasDataRef.current = false
    cursorRef.current = isoToSeconds(sinceRef.current)
    hasDataRef.current = false
  }, [])

  const applyCursorAdvance = useCallback((normalized: DerivedObservation[], nextSince?: number) => {
    if (normalized.length) {
      const last = normalized.at(-1)!
      lastTimestampRef.current = last.timestamp
      cursorRef.current = Math.floor(last.date.getTime() / 1000) + 1
    } else if (typeof nextSince === 'number') {
      cursorRef.current = nextSince
    }
  }, [])

  const fetchBatch = useCallback(async () => {
    if (!authHeader.current) {
      throw new Error('Missing WindBorne API credentials (set VITE_WB_CLIENT_ID & VITE_WB_API_KEY).')
    }

    const params = new URLSearchParams({
      limit: String(Math.min(limit, 500)),
      since: String(Math.max(0, Math.floor(cursorRef.current))),
      include_ids: 'true',
    })

    if (missionId) {
      params.set('mission_id', missionId)
    }

    const response = await fetch(`${API_URL}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        Authorization: authHeader.current,
      },
    })
    if (!response.ok) {
      throw new Error(`WindBorne API error (${response.status})`)
    }

    const text = await response.text()
    const parsed = safeParseV2Payload(text)
    if (!parsed) {
      throw new Error('Unexpected WindBorne response format')
    }

    const rawList: RawObservation[] = Array.isArray(parsed.observations)
      ? parsed.observations
      : []

    const normalized = rawList.map(normalizeObservation)
    applyCursorAdvance(normalized, parsed.next_since)
    return normalized
  }, [applyCursorAdvance, limit, missionId])

  const ingest = useCallback((incoming: DerivedObservation[]) => {
    if (!incoming.length) return
    setObservations((prev) => mergeChronologically(prev, incoming))
    setLastUpdated(new Date())
    hasDataRef.current = true
  }, [])

  const pull = useCallback(async () => {
    try {
      setStatus((current) => (current === 'ready' ? current : 'loading'))
      const batch = await fetchBatch()
      ingest(batch)
      setStatus('ready')
      setError(null)
    } catch (err) {
      console.error(err)
      if (!hasDataRef.current) {
        const fallback = buildSyntheticObservations(sinceRef.current, limit)
        setObservations(fallback)
        setLastUpdated(new Date())
        hasDataRef.current = true
        setStatus('ready')
        setError(
          'WindBorne API unavailable — playing a simulated mission inspired by recent flights.',
        )
      } else {
        setError(err instanceof Error ? err.message : 'Unable to reach WindBorne API')
        setStatus('error')
      }
    }
  }, [fetchBatch, ingest, limit])

  useEffect(() => {
    const sinceIso = defaultSinceIso(since)
    if ((missionId ?? null) !== missionRef.current || sinceIso !== sinceRef.current) {
      missionRef.current = missionId ?? null
      sinceRef.current = sinceIso
      cursorRef.current = isoToSeconds(sinceIso)
      resetState()
      setStatus('loading')
    }
  }, [missionId, resetState, since])

  useEffect(() => {
    if (!isActive) return undefined
    pull()
    if (!refreshMs) return undefined

    pollingRef.current && clearInterval(pollingRef.current)
    pollingRef.current = setInterval(() => {
      void pull()
    }, refreshMs)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [pull, refreshMs, isActive])

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [])

  const timeRange = useMemo(() => {
    if (!observations.length) return null
    return {
      start: observations[0].date,
      end: observations.at(-1)!.date,
    }
  }, [observations])

  return {
    observations,
    status,
    error,
    lastUpdated,
    timeRange,
    refresh: pull,
    since: new Date(sinceRef.current),
  }
}

function normalizeObservation(raw: RawObservation): DerivedObservation {
  const id = String(raw.id ?? raw.pk ?? raw.timestamp ?? cryptoRandomId())
  const missionId = String(raw.mission_id ?? raw.mission ?? 'unknown')
  const timestamp = resolveTimestamp(
    raw.timestamp ?? raw.datetime ?? raw.observation_time ?? Date.now(),
  )
  const date = new Date(timestamp)

  const altitude = coalesceNumber(
    [raw.altitude, raw.altitude_m, raw.altitude_agl, raw.altitude_from_gps],
    0,
  )
  const temperature = coalesceNumber(
    [raw.temperature, raw.temperature_c, raw.temp, raw.temperature_celsius],
    0,
  )
  const humidity = coalesceNumber(
    [raw.humidity, raw.relative_humidity, raw.rh, raw.humidity_percent],
    0,
  )
  const speed_u = coalesceNumber([raw.speed_u, raw.wind_u, raw.u_component], 0)
  const speed_v = coalesceNumber([raw.speed_v, raw.wind_v, raw.v_component], 0)

  const windSpeed = Math.hypot(speed_u, speed_v)

  return {
    id,
    missionId,
    timestamp,
    date,
    altitude,
    temperature,
    humidity,
    speed_u,
    speed_v,
    windSpeed,
  }
}

function resolveTimestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // API returns seconds since epoch
    const ms = value > 1e12 ? value : value * 1000
    return new Date(ms).toISOString()
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'string') {
    const maybeNumber = Number(value)
    if (Number.isFinite(maybeNumber)) {
      const ms = maybeNumber > 1e12 ? maybeNumber : maybeNumber * 1000
      return new Date(ms).toISOString()
    }
    return value
  }
  return new Date().toISOString()
}

function mergeChronologically(
  current: DerivedObservation[],
  incoming: DerivedObservation[],
): DerivedObservation[] {
  const merged = new Map<string, DerivedObservation>()
  for (const obs of current) {
    merged.set(obs.id || obs.timestamp, obs)
  }
  for (const obs of incoming) {
    merged.set(obs.id || obs.timestamp, obs)
  }

  return Array.from(merged.values()).sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  )
}

function coalesceNumber(values: Array<unknown>, fallback: number): number {
  for (const value of values) {
    const num = Number(value)
    if (Number.isFinite(num)) return num
  }
  return fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function defaultSinceIso(explicit?: Date) {
  const base = explicit ?? new Date(Date.now() - 24 * 60 * 60 * 1000)
  return base.toISOString()
}

function buildSyntheticObservations(startIso: string, count: number): DerivedObservation[] {
  const startMs = new Date(startIso).getTime()
  const durationMs = 24 * 60 * 60 * 1000
  const step = durationMs / Math.max(count, 1)
  const missionId = 'windborne-sim'

  return Array.from({ length: count }, (_, index) => {
    const timestampMs = startMs + index * step + randRange(-2, 2) * 60 * 1000
    const progress = index / Math.max(1, count - 1)
    const altitude = 500 + easeInOut(progress) * 29000 + randRange(-800, 800)
    const temperature = -65 + progress * 40 + randRange(-5, 5)
    const humidity = clamp(25 + Math.sin(progress * Math.PI * 4) * 30 + randRange(-5, 5), 5, 95)
    const windSpeed = clamp(8 + Math.cos(progress * Math.PI * 3) * 18 + randRange(-3, 3), 2, 60)
    const direction = progress * Math.PI * 2 + randRange(-0.3, 0.3)
    const speed_u = Math.cos(direction) * windSpeed
    const speed_v = Math.sin(direction) * windSpeed

    return {
      id: `${missionId}-${timestampMs}`,
      missionId,
      timestamp: new Date(timestampMs).toISOString(),
      date: new Date(timestampMs),
      altitude,
      temperature,
      humidity,
      speed_u,
      speed_v,
      windSpeed,
    }
  })
}

function randRange(min: number, max: number) {
  return Math.random() * (max - min) + min
}

function easeInOut(t: number) {
  return 0.5 * (1 - Math.cos(Math.PI * clamp(t, 0, 1)))
}

function safeParseV2Payload(text: string): ObservationsResponse | null {
  try {
    const parsed = JSON.parse(text) as ObservationsResponse
    return parsed
  } catch (error) {
    console.error('Failed to parse WindBorne v2 payload', error)
    return null
  }
}

function isoToSeconds(isoString: string) {
  return Math.floor(new Date(isoString).getTime() / 1000)
}

function buildAuthHeader() {
  const clientId = import.meta.env.VITE_WB_CLIENT_ID
  const apiKey = import.meta.env.VITE_WB_API_KEY
  if (!clientId || !apiKey) return null
  const encoded = encodeBase64(`${clientId}:${apiKey}`)
  return `Basic ${encoded}`
}

function encodeBase64(value: string) {
  if (typeof btoa === 'function') {
    return btoa(value)
  }
  const maybeBuffer = (globalThis as any).Buffer
  if (maybeBuffer && typeof maybeBuffer.from === 'function') {
    return maybeBuffer.from(value, 'binary').toString('base64')
  }
  return value
}
