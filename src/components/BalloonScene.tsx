import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars, useGLTF } from '@react-three/drei'
import { Suspense, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { DerivedObservation } from '../hooks/useObservationStream'

type BalloonSceneProps = {
  observation: DerivedObservation | null
  isPlaying: boolean
}

const ALTITUDE_MIN = 0
const ALTITUDE_MAX = 32000

export function BalloonScene({ observation, isPlaying }: BalloonSceneProps) {
  const bgColor = observation ? atmosphereColor(observation) : '#0c1120'
  const fogColor = new THREE.Color(bgColor).offsetHSL(0, -0.05, -0.1).getStyle()

  return (
    <Canvas camera={{ position: [0, 4, 16], fov: 40 }} shadows>
      <color attach="background" args={[bgColor]} />
      <fog attach="fog" args={[fogColor, 20, 60]} />
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[10, 15, 10]}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        intensity={1.4}
      />
      <Suspense fallback={null}>
        <Balloon
          altitude={observation?.altitude ?? 0}
          windSpeed={observation?.windSpeed ?? 0}
          isPlaying={isPlaying}
        />
      </Suspense>
      <Stars
        radius={100}
        depth={50}
        count={3000}
        factor={2}
        saturation={0}
        fade
      />
      <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={0.4} />
    </Canvas>
  )
}

type BalloonProps = {
  altitude: number
  windSpeed: number
  isPlaying: boolean
}

function Balloon({ altitude, windSpeed, isPlaying }: BalloonProps) {
  const { scene } = useGLTF('/balloon/scene.gltf')
  const ref = useRef<THREE.Group>(null)
  const drift = useMemo(() => windToDrift(windSpeed), [windSpeed])

  const model = useMemo(() => scene.clone(true), [scene])

  useFrame((state, delta) => {
    if (!ref.current) return
    const targetY = THREE.MathUtils.mapLinear(
      clamp(altitude, ALTITUDE_MIN, ALTITUDE_MAX),
      ALTITUDE_MIN,
      ALTITUDE_MAX,
      2,
      18,
    )
    ref.current.position.y = THREE.MathUtils.damp(
      ref.current.position.y,
      targetY,
      2,
      delta,
    )

    const time = state.clock.elapsedTime
    const sway = Math.sin(time * 0.5) * drift.magnitude
    const bob = Math.sin(time * 0.8) * 0.4
    ref.current.position.x = THREE.MathUtils.damp(ref.current.position.x, sway, 2, delta)
    ref.current.position.z = THREE.MathUtils.damp(ref.current.position.z, bob, 2, delta)
    ref.current.rotation.z = THREE.MathUtils.damp(
      ref.current.rotation.z,
      Math.sin(time * drift.frequency) * 0.2 * drift.magnitude,
      2,
      delta,
    )

    if (!isPlaying) {
      ref.current.rotation.x = THREE.MathUtils.damp(ref.current.rotation.x, 0, 3, delta)
      return
    }

    ref.current.rotation.x = Math.sin(time * 0.3) * 0.1
  })

  return <primitive ref={ref} object={model} dispose={null} scale={0.06} />
}

useGLTF.preload('/balloon/scene.gltf')

function atmosphereColor(observation: DerivedObservation) {
  const temperatureRatio = clamp((observation.temperature + 80) / 120, 0, 1)
  const humidityRatio = clamp(observation.humidity / 100, 0, 1)
  const color = new THREE.Color()
  const hue = THREE.MathUtils.lerp(0.58, 0.05, temperatureRatio)
  const saturation = THREE.MathUtils.lerp(0.35, 0.65, humidityRatio)
  const lightness = THREE.MathUtils.lerp(0.25, 0.55, humidityRatio)
  color.setHSL(hue, saturation, lightness)
  return color.getStyle()
}

function windToDrift(windSpeed: number) {
  const magnitude = THREE.MathUtils.clamp(windSpeed / 60, 0.05, 1.2)
  return { magnitude, frequency: THREE.MathUtils.lerp(0.4, 2.4, magnitude) }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export default BalloonScene
