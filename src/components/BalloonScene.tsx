import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Sky, useGLTF } from '@react-three/drei'
import { Suspense, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { DerivedObservation } from '../hooks/useObservationStream'

type BalloonSceneProps = {
  observation: DerivedObservation | null
  isPlaying: boolean
}

const ALTITUDE_MIN = 0
const ALTITUDE_MAX = 32000

export function BalloonScene({ observation, isPlaying }: BalloonSceneProps) {
  const bgColor = observation ? atmosphereColor(observation) : '#5f8fdd'
  const fogColor = '#4369a8'
  const sunPosition = useMemo(() => {
    const altitudeRatio = clamp((observation?.altitude ?? 15000) / ALTITUDE_MAX, 0, 1)
    const y = 15 + altitudeRatio * 25
    const x = 30 * Math.cos(altitudeRatio * Math.PI * 0.6)
    const z = -20
    return [x, y, z] as [number, number, number]
  }, [observation?.altitude])

  return (
    <Canvas camera={{ position: [0, 4, 16], fov: 40 }} shadows>
      <color attach="background" args={[bgColor]} />
      <fog attach="fog" args={[fogColor, 35, 120]} />
      <Sky distance={450000} sunPosition={sunPosition} turbidity={4.2} rayleigh={2} mieCoefficient={0.0035} mieDirectionalG={0.82} azimuth={0.12} inclination={0.4} />
      <ambientLight intensity={0.38} color="#dce7ff" />
      <hemisphereLight args={["#8cb8ff", "#192033", 0.5]} />
      <directionalLight
        position={sunPosition}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        intensity={1.1}
        color="#ffdfb3"
      />
      <Suspense fallback={null}>
        <CloudLayer />
        <Balloon
          altitude={observation?.altitude ?? 0}
          windSpeed={observation?.windSpeed ?? 0}
          isPlaying={isPlaying}
        />
      </Suspense>
      <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={0.25} />
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
  const { camera } = useThree()
  const cameraOffset = useMemo(() => new THREE.Vector3(0, 1.8, 10), [])
  const tempVec = useMemo(() => new THREE.Vector3(), [])
  const travelRef = useRef(0)

  const model = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    return clone
  }, [scene])

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
    ref.current.rotation.z = THREE.MathUtils.damp(
      ref.current.rotation.z,
      Math.sin(time * drift.frequency) * 0.2 * drift.magnitude,
      2,
      delta,
    )

    const travelSpeed = 0.6 + windSpeed / 90
    travelRef.current -= travelSpeed * delta
    const desiredZ = travelRef.current + bob
    ref.current.position.z = THREE.MathUtils.damp(ref.current.position.z, desiredZ, 1.2, delta)

    if (!isPlaying) {
      ref.current.rotation.x = THREE.MathUtils.damp(ref.current.rotation.x, 0, 3, delta)
    } else {
      ref.current.rotation.x = Math.sin(time * 0.3) * 0.1
    }

    const targetCam = tempVec.copy(ref.current.position).add(cameraOffset)
    targetCam.y = THREE.MathUtils.clamp(ref.current.position.y + cameraOffset.y, 1.5, 7.5)
    targetCam.x = THREE.MathUtils.lerp(camera.position.x, targetCam.x, 0.08)
    targetCam.z = ref.current.position.z + cameraOffset.z
    camera.position.lerp(targetCam, 0.05)
    const lookTarget = tempVec.set(
      ref.current.position.x,
      THREE.MathUtils.lerp(camera.position.y, ref.current.position.y + 1.2, 0.4),
      ref.current.position.z - 2,
    )
    camera.lookAt(lookTarget)
  })

  return <primitive ref={ref} object={model} dispose={null} scale={0.06} />
}

useGLTF.preload('/balloon/scene.gltf')
useGLTF.preload('/low_poly_cloud/scene.gltf')

type CloudMeta = {
  object: THREE.Object3D
  speed: number
  baseY: number
  offset: number
}

function CloudLayer() {
  const { scene } = useGLTF('/low_poly_cloud/scene.gltf')
  const clouds = useMemo<CloudMeta[]>(() => {
    return Array.from({ length: 12 }).map(() => {
      const cloud = scene.clone(true)
      cloud.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = false
          child.receiveShadow = false
          if ((child as THREE.Mesh).material) {
            const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial
            mat.color = new THREE.Color('#fefef9')
            mat.transparent = true
            mat.opacity = 0.65
          }
        }
      })
      const scale = THREE.MathUtils.randFloat(2, 4.5)
      cloud.scale.setScalar(scale)
      cloud.position.set(
        THREE.MathUtils.randFloatSpread(70),
        THREE.MathUtils.randFloat(7, 20),
        THREE.MathUtils.randFloat(-45, 0),
      )
      cloud.rotation.y = Math.random() * Math.PI * 2
      return {
        object: cloud,
        speed: THREE.MathUtils.randFloat(0.15, 0.35),
        baseY: cloud.position.y,
        offset: Math.random() * Math.PI * 2,
      }
    })
  }, [scene])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    clouds.forEach((cloud) => {
      cloud.object.position.x += cloud.speed * delta
      if (cloud.object.position.x > 45) {
        cloud.object.position.x = -45
      }
      cloud.object.position.y = cloud.baseY + Math.sin(t * 0.2 + cloud.offset) * 0.3
    })
  })

  return <group>{clouds.map((cloud, idx) => <primitive key={idx} object={cloud.object} />)}</group>
}

function atmosphereColor(observation: DerivedObservation) {
  const temperatureRatio = clamp((observation.temperature + 80) / 120, 0, 1)
  const humidityRatio = clamp(observation.humidity / 100, 0, 1)
  const color = new THREE.Color()
  const hue = THREE.MathUtils.lerp(0.58, 0.12, temperatureRatio)
  const saturation = THREE.MathUtils.lerp(0.4, 0.55, humidityRatio)
  const lightness = THREE.MathUtils.lerp(0.3, 0.45, humidityRatio)
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
