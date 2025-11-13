import { useCallback, useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'
import type { DerivedObservation } from './useObservationStream'

type AudioNodes = {
  synth: Tone.PolySynth
  filter: Tone.Filter
  reverb: Tone.Reverb
  gain: Tone.Gain
  lfo: Tone.LFO
}

const ALTITUDE_RANGE = { min: 0, max: 33000 }
const TEMPERATURE_RANGE = { min: -80, max: 35 }
const WIND_RANGE = { min: 0, max: 70 }
const HUMIDITY_RANGE = { min: 0, max: 100 }

const SCALE = ['C3', 'D3', 'E3', 'G3', 'A3', 'C4', 'D4', 'E4', 'G4', 'A4', 'C5']

export function useBalloonSonifier() {
  const nodesRef = useRef<AudioNodes | null>(null)
  const [isReady, setIsReady] = useState(false)

  const setup = useCallback(async () => {
    if (nodesRef.current) return nodesRef.current

    await Tone.start()

    const gain = new Tone.Gain(0.4).toDestination()
    const reverb = new Tone.Reverb({ decay: 6, wet: 0.3 }).connect(gain)
    const filter = new Tone.Filter({ type: 'bandpass', frequency: 800, Q: 1 }).connect(reverb)
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.4, decay: 0.2, sustain: 0.6, release: 2.5 },
    }).connect(filter)
    const lfo = new Tone.LFO({ type: 'sine', frequency: 0.2, min: 0.2, max: 0.8 })
    lfo.connect(gain.gain)
    lfo.start()

    nodesRef.current = { synth, filter, reverb, gain, lfo }
    setIsReady(true)
    return nodesRef.current
  }, [])

  const triggerObservation = useCallback(
    async (observation: DerivedObservation) => {
      const nodes = await setup()
      if (!nodes) return

      const pitch = altitudeToPitch(observation.altitude)
      const filterFrequency = temperatureToFrequency(observation.temperature)
      const reverbWet = humidityToReverb(observation.humidity)
      const gainLevel = windToGain(observation.windSpeed)
      const lfoRate = windToLfo(observation.windSpeed)

      nodes.filter.frequency.rampTo(filterFrequency, 0.5)
      nodes.reverb.wet.rampTo(reverbWet, 0.5)
      nodes.gain.gain.rampTo(gainLevel, 0.3)
      nodes.lfo.frequency.rampTo(lfoRate, 0.6)

      nodes.synth.triggerAttackRelease(pitch, '4n', undefined, 0.8)
    },
    [setup],
  )

  useEffect(() => {
    return () => {
      if (!nodesRef.current) return
      nodesRef.current.lfo.dispose()
      nodesRef.current.synth.dispose()
      nodesRef.current.filter.dispose()
      nodesRef.current.reverb.dispose()
      nodesRef.current.gain.dispose()
    }
  }, [])

  return {
    initializeAudio: setup,
    triggerObservation,
    isReady,
  }
}

function altitudeToPitch(altitude: number) {
  const ratio = normalize(altitude, ALTITUDE_RANGE)
  const index = Math.min(
    SCALE.length - 1,
    Math.max(0, Math.floor(ratio * SCALE.length)),
  )
  return SCALE[index]
}

function temperatureToFrequency(temperature: number) {
  const ratio = normalize(temperature, TEMPERATURE_RANGE)
  return 200 + ratio * 6500
}

function humidityToReverb(humidity: number) {
  const ratio = normalize(humidity, HUMIDITY_RANGE)
  return 0.1 + ratio * 0.7
}

function windToGain(windSpeed: number) {
  const ratio = normalize(windSpeed, WIND_RANGE)
  return 0.2 + ratio * 0.8
}

function windToLfo(windSpeed: number) {
  const ratio = normalize(windSpeed, WIND_RANGE)
  return 0.1 + ratio * 6
}

function normalize(value: number, range: { min: number; max: number }) {
  const clamped = clamp(value, range.min, range.max)
  return (clamped - range.min) / (range.max - range.min || 1)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
