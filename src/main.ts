import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { makeNoise3D, NOISE3D } from './core/noise'
import { mergeStatic } from './core/geometry'
import { Raptor, GEO, RC, CH4X } from './engine/raptor'
import { Plume, PHYS } from './engine/plume'
import { FLUIDS, FLUID_TIME, FLUID_RATE, FLUID_ON } from './engine/fluid'
import { Pipeline } from './render/pipeline'
import { Room, PUMP_POS, FUSION_POS, TOKAMAK_MID, LINE_POS } from './scene/room'
import { Turbopump, PUMP_FLUID } from './pump/turbopump'
import { S, changed, EngineView, Exhibit, EXHIBITS, PATHS, exhibitFromPath } from './state'
import { UI } from './ui/ui'
import { Labels } from './ui/labels'
import { CameraRig, SHOTS } from './camera'
import { Director, droneTour, grandTour, f1Tour, jetTour, holeTour, robotTour, mainTour, pumpTour, fusionTour, lineTour, hallTour, TourName } from './director'
import { Tokamak, TK_EMPH, TK_RATE } from './fusion/tokamak'
import { PLASMA, GLOW_TIME, TK } from './fusion/plasma'
import { FUSION } from './fusion/physics'
import { PowerPlant, PLANT } from './fusion/powerplant'
import { FUSION_PLATFORM } from './scene/room'
import { ProductionLine, LINE_TOP } from './line/line'
import { STATIONS, LINE_X } from './line/sim'
import { Truck, CAR_EMPH, TR } from './car/truck'
import { DriveUnit, DU_EMPH } from './car/driveunit'
import { CAR_POS, DECK, DRIVE_POS, visualSpin } from './car/bay'
import { load, launchAccel, TRUCK } from './car/physics'
import { Humanoid, RobotStage, BOT, gait, robotLoad, Pose, Joint } from './robot/humanoid'
import { ROBOT_POS } from './scene/room'
import { Specimens } from './robot/actuators'
import { Portal, PORTAL, HOLE, massOf } from './hole/portal'
import { JetEngine, JET, JET_FLOW, JET_STATIONS, plumeMesh } from './jet/jet'
import { JET_POS, F1_POS, DRONE_POS } from './scene/room'
import { Drone, DroneCage, DroneSim, DR, DRONE_FLOW, MOTORS } from './drone/drone'
import { F1Car, F1Bay, F1, F1_FLOW } from './f1/f1'
import { surf as surfMat, matte as matteMat } from './core/materials'
import { revolve as revolveG } from './core/geometry'
import { HOLE_POS } from './scene/room'
import { carTour, motorTour } from './director'

const params = new URLSearchParams(location.search)
const REC = params.get('rec')
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/** Where each exhibit lives: home shot, a sphere for picking, how far the user may zoom out. */
const HOME: Record<Exhibit, { shot: string; center: THREE.Vector3; r: number; maxDist: number }> = {
  hall: { shot: 'hall', center: new THREE.Vector3(7, 1.2, 0), r: 0, maxDist: 36 },
  fusion: { shot: 'fusion', center: new THREE.Vector3(FUSION_POS.x, TOKAMAK_MID, FUSION_POS.z), r: 2.5, maxDist: 12 },
  engine: { shot: 'hero', center: new THREE.Vector3(-0.2, 1.3, 0), r: 2.3, maxDist: 7.5 },
  pump: { shot: 'pump', center: new THREE.Vector3(PUMP_POS.x, PUMP_POS.y + 0.25, PUMP_POS.z), r: 0.75, maxDist: 5 },
  line: { shot: 'line', center: new THREE.Vector3(LINE_POS.x + 0.1, 1.2, LINE_POS.z), r: 3.3, maxDist: 10 },
  car: { shot: 'car', center: new THREE.Vector3(CAR_POS.x, 1.1, CAR_POS.z), r: 3.0, maxDist: 18 },
  drone: { shot: 'drone', center: new THREE.Vector3(DRONE_POS.x, 1.7, DRONE_POS.z), r: 1.2, maxDist: 10 },
  f1: { shot: 'f1', center: new THREE.Vector3(F1_POS.x, 0.7, F1_POS.z), r: 3.0, maxDist: 14 },
  jet: { shot: 'jet', center: new THREE.Vector3(JET_POS.x + 2.8, JET_POS.y, JET_POS.z), r: 3.2, maxDist: 14 },
  hole: { shot: 'hole', center: new THREE.Vector3(HOLE_POS.x, 2.2, HOLE_POS.z), r: 2.6, maxDist: 14 },
  robot: { shot: 'robot', center: new THREE.Vector3(ROBOT_POS.x, 1.2, ROBOT_POS.z), r: 1.6, maxDist: 9 },
  motor: { shot: 'motor', center: new THREE.Vector3(DRIVE_POS.x, DRIVE_POS.y + 0.38, DRIVE_POS.z), r: 0.55, maxDist: 5 },
}

const goTo = (ex: Exhibit, prev: Exhibit) => {
  if (!director.active) {
    const far = HOME[ex].center.distanceTo(HOME[prev].center)
    rig.fly(HOME[ex].shot, ex === 'hall' || prev === 'hall' ? 2.8 : Math.min(3.4, 1.8 + far * 0.1), ex === 'hall' || prev === 'hall' ? 0.2 : Math.min(1.2, far * 0.06))
  }
  controlsRef.maxDistance = Math.max(HOME[ex].maxDist * rig.scale, 1)
  const path = PATHS[ex]
  if (/^\/(lab|rocket-engine)/.test(location.pathname) && location.pathname !== path) history.replaceState(null, '', path + location.search)
}

const ui = new UI({
  onExhibit: (ex, prev) => goTo(ex, prev),
  onFusionView: (view: EngineView, prev: EngineView) => {
    if (director.active) return
    if (view === 'exploded') rig.fly('fusionExploded', 1.8)
    else if (prev === 'exploded') rig.fly('fusion', 1.8)
  },
  onFusionFollow: (f) => {
    if (director.active) return
    if (f === 'power') rig.fly('fusionPower', 2.2, 0.2)
  },
  onLine: () => lineApply(),
  onView: (view: EngineView, prev: EngineView) => {
    if (director.active) return
    if (view === 'exploded') rig.fly('exploded', 1.8)
    else if (prev === 'exploded') rig.fly(view === 'cut' ? 'cut' : 'hero', 1.8)
  },
  onTour: () => startTour(S.exhibit === 'pump' ? 'pump' : S.exhibit === 'engine' ? 'main' : S.exhibit === 'line' ? 'line' : S.exhibit === 'hall' ? 'hall' : S.exhibit === 'car' ? 'car' : S.exhibit === 'motor' ? 'motor' : S.exhibit === 'robot' ? 'robot' : S.exhibit === 'hole' ? 'hole' : S.exhibit === 'jet' ? 'jet' : S.exhibit === 'f1' ? 'f1' : S.exhibit === 'drone' ? 'drone' : 'fusion', false),
  onRobotView: (view, prev) => {
    if (director.active) return
    if (view === 'exploded') rig.fly('robotExploded', 1.8)
    else if (view === 'actuator') rig.fly('robotActuator', 2.0, 0.1)
    else if (view === 'xray' && prev === 'whole') rig.fly('robotXray', 2.0)
    else if (prev === 'exploded' || prev === 'actuator') rig.fly('robot', 1.8)
  },
  onHoleView: () => {},
  onDroneView: (view, prev) => {
    if (director.active) return
    if (view === 'exploded') rig.fly('droneExploded', 1.8)
    else if (view === 'cut') rig.fly('droneCut', 1.8)
    else if (prev !== 'whole') rig.fly('drone', 1.8)
  },
  onDroneFollow: (f) => {
    if (director.active) return
    if (f === 'air') rig.fly('droneAir', 1.8)
    else if (f === 'sensors') rig.fly('droneTop', 1.8)
  },
  onDroneMode: (m) => {
    if (director.active) return
    if (m === 'wind') rig.fly('droneWind', 1.8)
    else if (m === 'gust') rig.fly('droneGimbal', 1.8)
  },
  onF1View: (view, prev) => {
    if (director.active) return
    if (view === 'exploded') rig.fly('f1Exploded', 2.0)
    else if (view === 'cut') rig.fly('f1Cut', 2.0)
    else if (prev !== 'whole') rig.fly('f1', 2.0)
  },
  onF1Follow: (f) => {
    if (director.active) return
    if (f === 'air') rig.fly('f1Air', 2.0)
    else if (f === 'pressure') rig.fly('f1', 2.0)
  },
  onF1Mode: (m) => {
    if (director.active) return
    if (m === 'straight') rig.fly('f1Wing', 2.0)
    else if (m === 'brake') rig.fly('f1Brake', 2.0)
  },
  onJetView: (view, prev) => {
    if (director.active) return
    if (view === 'exploded') rig.fly('jetExploded', 2.0)
    else if (view === 'cut' && prev === 'whole') rig.fly('jetCut', 2.0)
    else if (prev === 'exploded') rig.fly('jet', 2.0)
  },
  onJetFollow: (f) => {
    if (director.active) return
    if (f === 'air') rig.fly('jetFan', 2.0)
    else if (f === 'fire') rig.fly('jetHot', 2.0)
    else if (f === 'core' || f === 'spools' || f === 'heat') rig.fly('jetCut', 2.0)
  },
  onHoleMode: (m) => {
    if (director.active) return
    if (m === 'probe') rig.fly('holeClose', 2.2)
  },
  onRobotFollow: (f) => {
    if (director.active) return
    if (f === 'actuators') rig.fly('robotLegs', 2.0)
    else if (f === 'power') rig.fly('robotPower', 2.0)
    else if (f === 'hands') rig.fly('robotHands', 2.0)
  },
  onCarView: (view, prev) => {
    if (director.active) return
    if (view === 'exploded') rig.fly('carExploded', 2.0)
    else if (prev === 'exploded') rig.fly(view === 'xray' ? 'carXray' : 'car', 2.0)
  },
  onCarFollow: (f) => {
    if (director.active) return
    if (f === 'energy') rig.fly('carEnergy', 2.2)
    else if (f === 'motors') rig.fly('carMotors', 2.2, 0.2)
    else if (f === 'structure') rig.fly('carStructure', 2.2)
  },
  onMotorView: (view, prev) => {
    if (director.active) return
    if (view === 'exploded') rig.fly('motorExploded', 1.8)
    else if (prev === 'exploded') rig.fly('motor', 1.8)
  },
  onMotorFollow: (f) => {
    if (director.active) return
    if (f === 'gears') rig.fly('motorGears', 2.2, 0.15)
    else if (f === 'current' || f === 'field') rig.fly('motorFace', 1.8)
  },
})

const T0 = performance.now()
const mark = (label: string) => { if (params.get('debug')) console.log(`[boot] ${label} ${Math.round(performance.now() - T0)}ms`) }

async function boot() {
  ui.progress(0.05, 'Building the lab')
  await nextFrame()
  NOISE3D.value = makeNoise3D(64)

  const canvas = document.createElement('canvas')
  canvas.id = 'gl'
  canvas.tabIndex = 0
  document.getElementById('app')!.prepend(canvas)

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false })
  } catch {
    ui.progress(0, 'This needs WebGL 2. Try a recent Chrome, Safari or Firefox.')
    return
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.shadowMap.autoUpdate = false
  renderer.localClippingEnabled = true

  const mobile = matchMedia('(max-width: 760px), (pointer: coarse)').matches
  const quality = params.get('q') || (mobile ? 'mid' : 'high')

  const scene = new THREE.Scene()
  scene.background = null // a colour background would force-clear on every render() call
  mark('renderer')
  ui.progress(0.2, 'Setting up the lab')
  await nextFrame()
  const room = new Room(renderer)
  scene.add(room.group)
  scene.environment = room.envMap
  scene.environmentIntensity = 1.0

  mark('room')
  ui.progress(0.4, 'Building the engine')
  await nextFrame()
  const raptor = new Raptor()
  room.engineMount.add(raptor.root)
  const plume = new Plume(raptor.root, scene)

  mark('engine')
  ui.progress(0.6, 'Building the turbopump')
  await nextFrame()
  const pump = new Turbopump()
  pump.root.rotation.z = -Math.PI / 2
  pump.root.position.set(0, 0.3, 0)
  pump.root.scale.setScalar(0.85)
  room.pumpMount.add(pump.root)
  {
    // soft contact shadow under the pump (the pump spot does not cast a shadow map)
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')!
    const rg = g.createRadialGradient(64, 64, 4, 64, 64, 64)
    rg.addColorStop(0, 'rgba(0,0,0,0.75)')
    rg.addColorStop(0.55, 'rgba(0,0,0,0.35)')
    rg.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = rg
    g.fillRect(0, 0, 128, 128)
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }))
    sh.rotation.x = -Math.PI / 2
    sh.position.set(0.02, -0.006, 0)
    room.pumpMount.add(sh)
  }
  mark('pump')
  ui.progress(0.66, 'Building the fusion reactor')
  await nextFrame()
  const tok = new Tokamak()
  room.fusionMount.add(tok.root)
  ui.progress(0.72, 'Building the production line')
  await nextFrame()
  const plant = new PowerPlant(FUSION_POS, FUSION_PLATFORM)
  room.group.add(plant.group)
  const line = new ProductionLine()
  room.lineMount.add(line.root)
  lineApply = () => {
    Object.assign(line.sim.settings, S.line)
    line.sim.apply()
  }
  lineApply()
  line.warm(40)
  ui.progress(0.76, 'Building the truck')
  await nextFrame()
  const truck = new Truck()
  room.bay.carMount.add(truck.root)
  const du = new DriveUnit()
  du.root.position.set(0, 0.4, 0)
  du.root.rotation.y = 0.55
  room.bay.driveMount.add(du.root)
  ui.progress(0.8, 'Building the robot')
  await nextFrame()
  const stage = new RobotStage()
  stage.group.position.copy(ROBOT_POS)
  stage.group.rotation.y = 0.32
  room.group.add(stage.group)
  const bot = new Humanoid()
  stage.mount.add(bot.root)
  const jet = new JetEngine()
  jet.root.position.copy(JET_POS)
  jet.root.rotation.z = -Math.PI / 2
  scene.add(jet.root)
  const jetPlume = plumeMesh(NOISE3D)
  jetPlume.position.set(0, JET.length + 0.02, 0)
  jet.root.add(jetPlume)
  const jetLight = new THREE.PointLight(0xff8a3a, 0, 12, 2)
  jetLight.position.set(JET_POS.x + JET.length + 1.5, JET_POS.y, JET_POS.z)
  scene.add(jetLight)
  {
    // the test cell: an overhead thrust frame, an inlet bellmouth and the exhaust collector
    const J = JET_POS
    const frameM = surfMat({ color: 0x2b5c9a, metalness: 0.5, roughness: 0.4, detail: 3, clearcoat: 0.4 })
    const steelM = surfMat({ color: 0xb9bdc3, metalness: 1, roughness: 0.3, detail: 4, anisotropy: 0.5 })
    const darkM = surfMat({ color: 0x1e2127, metalness: 0.7, roughness: 0.4, detail: 3 })
    const cell = new THREE.Group()
    scene.add(cell)
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; cell.add(o); return o }
    // posts only behind the engine, beams reach forward over it: nothing between the camera and the engine
    for (const x of [J.x + 0.6, J.x + 4.4]) mk(new THREE.BoxGeometry(0.22, 3.6, 0.22), frameM, x, 1.8, J.z - 1.3)
    mk(new THREE.BoxGeometry(4.2, 0.3, 0.22), frameM, J.x + 2.5, 3.6, J.z - 1.3)
    for (const x of [J.x + 1.2, J.x + 3.8]) mk(new THREE.BoxGeometry(0.22, 0.26, 1.65), frameM, x, 3.6, J.z - 0.55)
    for (const x of [J.x + 1.2, J.x + 3.8]) mk(new THREE.CylinderGeometry(0.03, 0.03, 3.45 - (J.y + 0.6), 10), steelM, x, (3.45 + J.y + 0.6) / 2, J.z)
    // bellmouth: a smooth flared lip that feeds the inlet evenly
    const bm = new THREE.Mesh(revolveG([[0.66, 0], [0.7, 0], [0.74, -0.25], [0.95, -0.55], [1.3, -0.7], [1.34, -0.66], [0.98, -0.5], [0.72, -0.2], [0.68, 0]], 128), steelM)
    bm.rotation.z = -Math.PI / 2
    bm.position.set(J.x - 0.62, J.y, J.z)
    cell.add(bm)
    // exhaust collector the flame roars into
    const col = new THREE.Mesh(revolveG([[1.25, 0], [1.4, 0], [1.4, 3.2], [1.25, 3.2]], 96), darkM)
    col.rotation.z = -Math.PI / 2
    col.position.set(J.x + JET.length + 5.6, J.y, J.z)
    cell.add(col)
    const colLip = new THREE.Mesh(revolveG([[1.25, -0.1], [1.9, -0.35], [1.95, -0.3], [1.4, 0.05]], 96), steelM)
    colLip.rotation.z = -Math.PI / 2
    colLip.position.copy(col.position)
    cell.add(colLip)
    for (const z of [J.z - 0.9, J.z + 0.9]) mk(new THREE.BoxGeometry(2.6, J.y - 1.4, 0.3), darkM, J.x + JET.length + 7.2, (J.y - 1.4) / 2, z)
    const plat = new THREE.Mesh(new THREE.BoxGeometry(JET.length + 11, 0.06, 5.2), matteMat(0x24272e, 0.5, { detail: 2 }))
    plat.position.set(J.x + JET.length / 2 + 3.5, 0.03, J.z)
    plat.receiveShadow = true
    cell.add(plat)
    const key = new THREE.SpotLight(0xfff2e6, 105, 16, 0.7, 0.85, 2)
    key.position.set(J.x + 1.5, 5.0, J.z + 5.0)
    key.target.position.set(J.x + 2.6, J.y, J.z)
    scene.add(key, key.target)
    const rim = new THREE.SpotLight(0x9dc0ff, 140, 16, 0.7, 0.9, 2)
    rim.position.set(J.x + 4.5, 4.4, J.z - 3.8)
    rim.target.position.set(J.x + 2.6, J.y, J.z)
    scene.add(rim, rim.target)
  }
  const f1bay = new F1Bay(F1_POS)
  scene.add(f1bay.group)
  const f1 = new F1Car()
  f1.root.position.set(F1_POS.x, F1_POS.y + 0.102, F1_POS.z)
  scene.add(f1.root)
  const drone = new Drone()
  scene.add(drone.root)
  scene.add(drone.air)
  const cage = new DroneCage(DRONE_POS, drone.cut)
  scene.add(cage.group)
  const dsim = new DroneSim()
  const droneAngles = [0, 0, 0, 0]
  const portal = new Portal(HOLE_POS)
  scene.add(portal.group)
  {
    const key = new THREE.SpotLight(0xfff2e6, 140, 14, 0.6, 0.85, 2)
    key.position.set(HOLE_POS.x + 2.5, 5.0, HOLE_POS.z + 4.5)
    key.target.position.set(HOLE_POS.x, 1.8, HOLE_POS.z)
    scene.add(key, key.target)
    HOLE.diskRot.value.setFromMatrix4(new THREE.Matrix4().makeRotationX(-0.16).multiply(new THREE.Matrix4().makeRotationZ(0.1)))
    HOLE.steps.value = REC ? 520 : quality === 'high' ? 260 : 180
  }
  const spec = new Specimens()
  spec.group.position.set(1.45, 0.85, 0.35)
  spec.group.rotation.y = -0.8
  spec.group.visible = false
  stage.mount.add(spec.group)
  {
    // lights, a halo and a blueprint for the robot's bay
    const R = ROBOT_POS
    const key = new THREE.SpotLight(0xfff2e6, 130, 12, 0.5, 0.8, 2)
    key.position.set(R.x + 1.8, 4.8, R.z + 3.2)
    key.target.position.set(R.x, 1.1, R.z)
    const rim = new THREE.SpotLight(0x9dc0ff, 120, 12, 0.55, 0.9, 2)
    rim.position.set(R.x - 2.2, 3.8, R.z - 2.8)
    rim.target.position.set(R.x, 1.2, R.z)
    room.group.add(key, key.target, rim, rim.target)
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.03, 12, 192), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff1de).multiplyScalar(2.4) }))
    halo.rotation.x = Math.PI / 2
    halo.position.set(R.x, 4.5, R.z)
    halo.layers.set(2)
    room.group.add(halo)
    const c = document.createElement('canvas')
    c.width = 1200
    c.height = 1600
    const g = c.getContext('2d')!
    g.fillStyle = '#081222'
    g.fillRect(0, 0, 1200, 1600)
    g.strokeStyle = 'rgba(80,140,210,0.14)'
    g.lineWidth = 2
    for (let x = 0; x < 1200; x += 50) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1600); g.stroke() }
    for (let y = 0; y < 1600; y += 50) { g.beginPath(); g.moveTo(0, y); g.lineTo(1200, y); g.stroke() }
    const P = (x: number, y: number) => [600 + x * 700, 1500 - y * 780] as [number, number]
    const j: Record<string, [number, number]> = {
      head: [0, 1.6], neck: [0, 1.47], ls: [0.21, 1.4], rs: [-0.21, 1.4], le: [0.24, 1.11], re: [-0.24, 1.11], lw: [0.24, 0.85], rw: [-0.24, 0.85],
      waist: [0, 1.06], lh: [0.1, 0.94], rh: [-0.1, 0.94], lk: [0.11, 0.52], rk: [-0.11, 0.52], la: [0.11, 0.09], ra: [-0.11, 0.09],
    }
    const bones = [['neck', 'waist'], ['ls', 'rs'], ['ls', 'le'], ['le', 'lw'], ['rs', 're'], ['re', 'rw'], ['waist', 'lh'], ['waist', 'rh'], ['lh', 'lk'], ['lk', 'la'], ['rh', 'rk'], ['rk', 'ra'], ['lh', 'rh']]
    g.strokeStyle = 'rgba(140,200,255,0.9)'
    g.lineWidth = 6
    for (const [a, b] of bones) { g.beginPath(); g.moveTo(...P(...j[a])); g.lineTo(...P(...j[b])); g.stroke() }
    g.beginPath(); g.arc(...P(...j.head), 70, 0, Math.PI * 2); g.stroke()
    for (const k of Object.keys(j)) if (k !== 'head') {
      g.fillStyle = 'rgba(255,200,120,0.95)'
      g.beginPath(); g.arc(...P(...j[k]), 16, 0, Math.PI * 2); g.fill()
    }
    g.fillStyle = 'rgba(190,210,240,0.8)'
    g.font = '500 40px "DM Mono", ui-monospace, monospace'
    g.fillText('1.73 m', 60, 90)
    g.fillText('28 actuators', 60, 150)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.4), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.05, 1.05, 1.05) }))
    pic.position.set(R.x - 0.6, 2.55, -4.5)
    pic.layers.set(2)
    room.group.add(pic)
  }
  // soft contact shadows under the feet
  const footShadows = [0, 1].map(() => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 64
    const gg = cv.getContext('2d')!
    const rg = gg.createRadialGradient(32, 32, 2, 32, 32, 32)
    rg.addColorStop(0, 'rgba(0,0,0,0.6)')
    rg.addColorStop(1, 'rgba(0,0,0,0)')
    gg.fillStyle = rg
    gg.fillRect(0, 0, 64, 64)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.36), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }))
    m.rotation.x = -Math.PI / 2
    m.position.y = 0.004
    stage.mount.add(m)
    return m
  })
  // fewer draw calls: one per material per part
  const mounts = [room.engineMount, room.pumpMount, room.fusionMount, room.lineMount, room.bay.carMount, room.bay.driveMount]
  const merged = [mergeStatic(stage.group, (m) => m.parent === stage.mount), mergeStatic(raptor.root), mergeStatic(pump.root), mergeStatic(tok.root), mergeStatic(line.root), mergeStatic(truck.root, (m) => !!m.userData.keep), mergeStatic(du.root), mergeStatic(room.group, (m) => mounts.includes(m.parent as THREE.Group))]
  if (params.get('debug')) console.log('merge', JSON.stringify(merged))
  raptor.cut.collect(raptor.root)
  pump.cut.collect(pump.root)
  tok.cut.collect(tok.root)
  mergeStatic(jet.root)
  jet.cut.collect(jet.root)
  f1.cut.collect(f1.root)
  f1.hollowSkins()
  drone.cut.collect(drone.root)
  drone.hollowSkins()
  du.cut.collect(du.root)
  mark('merged')


  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 80)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.075
  controls.minDistance = 0.35
  controls.maxDistance = 12
  controlsRef = controls
  controls.maxPolarAngle = Math.PI * 0.6
  controls.rotateSpeed = 0.7
  controls.zoomSpeed = 0.8
  rig = new CameraRig(camera, controls)
  director = new Director(rig)

  const pipeline = new Pipeline(renderer, { ao: quality !== 'low', msaa: quality === 'low' ? 0 : 4, aoSamples: REC ? 16 : 8 })
  pipeline.aoScale = REC ? 0.5 : 0.36
  // interactive quality is tuned for a laptop; the recorder gets everything
  pipeline.plumeScale = REC ? 0.6 : quality === 'high' ? 0.42 : 0.34
  pipeline.params.dofTaps = REC ? 40 : 14
  pipeline.params.sharpen = REC ? 0.15 : 0.3
  plume.material.uniforms.uSteps.value = REC ? 64 : quality === 'high' ? 36 : 28
  PLASMA.steps.value = REC ? 128 : quality === 'high' ? 72 : 48
  const labels = new Labels(document.getElementById('labels')!, camera)

  // initial state from the link
  S.exhibit = location.hash === '#turbopump' ? 'pump' : exhibitFromPath(location.pathname, params)
  controls.maxDistance = HOME[S.exhibit].maxDist * 2.2
  if (params.get('view')) S.engine.view = params.get('view') as EngineView
  if (params.get('follow')) S.engine.follow = params.get('follow') as typeof S.engine.follow
  if (params.get('throttle')) S.engine.throttle = Number(params.get('throttle'))
  if (params.get('alt')) S.engine.alt = Number(params.get('alt'))
  if (params.get('fview')) S.fusion.view = params.get('fview') as EngineView
  if (params.get('ffollow')) S.fusion.follow = params.get('ffollow') as typeof S.fusion.follow
  if (params.get('temp')) S.fusion.temp = Number(params.get('temp'))
  if (params.get('cview')) S.car.view = params.get('cview') as typeof S.car.view
  if (params.get('cfollow')) S.car.follow = params.get('cfollow') as typeof S.car.follow
  if (params.get('speed')) S.car.speed = Number(params.get('speed'))
  if (params.get('cmode')) S.car.mode = params.get('cmode') as typeof S.car.mode
  if (params.get('mview')) S.motor.view = params.get('mview') as EngineView
  if (params.get('mfollow')) S.motor.follow = params.get('mfollow') as typeof S.motor.follow
  if (params.get('mmode')) S.motor.mode = params.get('mmode') as typeof S.motor.mode
  if (params.get('rpm')) S.motor.rpm = Number(params.get('rpm'))
  rig.set(params.get('shot') || HOME[S.exhibit].shot)

  const rPose: Pose = { hip: [0, 0], hipRoll: [0, 0], knee: [0, 0], ankle: [0, 0], shoulder: [0, 0], shoulderOut: [0, 0], elbow: [0, 0], waist: 0, twist: 0, head: 0, grip: 0, pelvisYaw: 0, pelvisRoll: 0, sway: 0 }
  const anim = {
    cut: S.engine.view === 'whole' ? 0 : 1,
    explode: S.engine.view === 'exploded' ? 1 : 0,
    throttle: S.engine.throttle,
    alt: S.engine.alt,
    on: 1,
    pcut: 1,
    pexplode: 0,
    pspeed: 1,
    pcav: 0,
    pflash: 0,
    fcut: S.fusion.view === 'whole' ? 0 : 1,
    fexplode: S.fusion.view === 'exploded' ? 1 : 0,
    ftemp: S.fusion.temp,
    fon: 1,
    fshift: 0,
    fsize: 1,
    fflash: 0,
    fwobble: 0,
    ramp: 1,
    rphase: 0,
    rsq: 0,
    rcarry: 0,
    rexplode: 0,
    rxray: 0,
    rpower: 500,
    rknee: 40,
    ract: 0.3,
    cride: 0,
    csteer: 0,
    clight: 1,
    rspec: 0,
    rspin: 0,
    hopen: 1,
    hpower: 0.4,
    hspin: 0,
    hmix: 0,
    hdive: 0,
    hstage: 'watch',
    probeR: 9,
    probeClock: 0,
    probeStretch: 1,
    jthr: 1,
    f1v: 300,
    dcut: 0,
    dexp: 0,
    dwind: 0,
    f1open: 0,
    f1brake: 0,
    f1cut: 0,
    f1exp: 0,
    f1wheel: 0,
    jab: 1,
    jcut: 0,
    jexp: 0,
    jlp: 0,
    jhp: 0,
    hall: S.exhibit === 'hall' ? 1 : 0,
    cv: S.car.speed,
    ca: 0,
    cxray: S.car.view === 'xray' ? 1 : 0,
    cexplode: S.car.view === 'exploded' ? 1 : 0,
    wheel: 0,
    t100: null as number | null,
    regenK: 0,
    mrpm: S.motor.rpm,
    mangle: 0,
    mtorque: 1,
    mcut: S.motor.view === 'whole' ? 0 : 1,
    mexplode: S.motor.view === 'exploded' ? 1 : 0,
    mcover: 0,
  }

  /* ---------------- labels ---------------- */
  const part = (name: string) => raptor.parts.find((p) => p.name === name)!.group
  const v3 = new THREE.Vector3()
  const engineAt = (partName: string, x: number, y: number, z: number) => () => {
    v3.set(x, y, z * (1 - anim.cut * 0.92))
    return part(partName).localToWorld(v3.clone())
  }
  const E = () => (S.exhibit === 'engine' ? 1 : 0)
  const inCut = () => Math.min(anim.cut, 1) * E()
  const followVis = (...kinds: string[]) => () => {
    const f = S.engine.follow
    const base = inCut() * (anim.cut > 0.85 ? 1 : 0)
    return f === 'all' || kinds.includes(f) ? base : 0
  }
  const pc = () => `${Math.round(PHYS.state(anim.throttle, anim.alt).pc)} bar`
  labels.add({ id: 'loxpump', text: 'Oxygen turbopump', cls: 'ox', at: engineAt('loxPump', 0.25, 0.86, 0.35), vis: followVis('oxygen') })
  labels.add({ id: 'oxpb', text: 'Preburner', sub: 'oxygen rich', cls: 'gas', at: engineAt('loxPreburner', 0.15, 0.565, 0.26), vis: followVis('oxygen') })
  labels.add({ id: 'loxturb', text: 'Turbine', cls: 'gas', at: engineAt('loxTurbine', 0.12, 0.39, 0.3), vis: followVis('oxygen') })
  labels.add({ id: 'inj', text: 'Injector', at: engineAt('injector', -0.1, 0.05, 0.38), vis: followVis('oxygen', 'methane', 'fire') })
  labels.add({ id: 'chamber', text: 'Chamber', sub: pc, cls: 'fire', at: engineAt('tca', -0.06, -0.14, 0.22), vis: followVis('fire') })
  labels.add({ id: 'throat', text: 'Throat', sub: 'Mach 1', cls: 'fire', at: engineAt('tca', -0.1, GEO.yT, 0.13), vis: followVis('fire') })
  labels.add({ id: 'cool', text: 'Cooling channels', cls: 'ch4', at: engineAt('tca', -RC(-1.1), -1.1, RC(-1.1)), vis: followVis('methane') })
  labels.add({ id: 'ch4pump', text: 'Methane turbopump', cls: 'ch4', at: engineAt('ch4Pump', CH4X + 0.12, 0.62, 0.25), vis: followVis('methane') })
  labels.add({ id: 'fpb', text: 'Preburner', sub: 'methane rich', cls: 'ch4', at: engineAt('ch4Pump', CH4X, -0.12, 0.14), vis: followVis('methane') })
  labels.add({ id: 'duct', text: 'Hot gas duct', cls: 'ch4', at: engineAt('ch4Pump', 0.43, 0.09, 0.06), vis: followVis('methane') })
  labels.add({ id: 'gimbal', text: 'Gimbal', at: engineAt('gimbal', 0, 1.07, 0.29), vis: () => inCut() * (S.engine.follow === 'all' ? 1 : 0) * (anim.cut > 0.85 ? 1 : 0) })
  labels.add({ id: 'exit', text: 'Exit', sub: 'about Mach 4', cls: 'fire', at: engineAt('tca', -GEO.Re * 0.55, GEO.yE, 0.1), vis: followVis('fire') })
  const plumeAt = (k: number) => () => {
    const x = (k + 0.55) * plume.s.cell
    return new THREE.Vector3(x, 0, 0).applyMatrix4(plume.frame.matrix)
  }
  // hide plume labels when the engine stands between them and the camera
  const pc0 = new THREE.Vector3(), pc1 = new THREE.Vector3()
  const hiddenByEngine = (world: THREE.Vector3) => {
    pc0.copy(camera.position)
    raptor.root.worldToLocal(pc0)
    pc1.copy(world)
    raptor.root.worldToLocal(pc1)
    const R = GEO.Re + 0.08
    const dx = pc1.x - pc0.x, dz = pc1.z - pc0.z
    const a = dx * dx + dz * dz, b = 2 * (pc0.x * dx + pc0.z * dz), c = pc0.x * pc0.x + pc0.z * pc0.z - R * R
    const disc = b * b - 4 * a * c
    if (a < 1e-9 || disc < 0) return false
    const sq = Math.sqrt(disc)
    for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
      if (t < 0 || t > 1) continue
      const y = pc0.y + (pc1.y - pc0.y) * t
      if (y > GEO.yE && y < GEO.top) return true
    }
    return false
  }
  const plumeVisK = (k: number) => () => {
    const base = E() * (1 - anim.cut) * (1 - plume.s.vac) * (S.engine.alt < 60 ? 1 : 0) * anim.on
    if (base < 0.01) return 0
    return hiddenByEngine(plumeAt(k)()) ? 0 : base
  }
  const plumeVis = plumeVisK(0)
  const dist = (k: number) => () => `${((k + 0.55) * plume.s.cell * GEO.Re).toFixed(1)} m`
  labels.add({ id: 'md1', text: 'Shock diamond', sub: dist(0), cls: 'fire', at: plumeAt(0), vis: plumeVis })
  labels.add({ id: 'md2', text: 'Shock diamond', sub: dist(1), cls: 'fire', at: plumeAt(1), vis: plumeVisK(1) })
  const pumpAt = (name: string) => () => {
    const a = pump.anchors[name]
    if (!a) return null
    v3.copy(a[1])
    v3.z *= 1 - anim.pcut * 0.9
    return a[0].localToWorld(v3.clone())
  }
  const P = () => (S.exhibit === 'pump' ? Math.min(anim.pcut, 1) * (anim.pcut > 0.85 ? 1 : 0) : 0)
  const pf = (...kinds: string[]) => () => (S.pump.follow === 'all' || kinds.includes(S.pump.follow) ? P() : 0)
  labels.add({ id: 'p-in', text: 'Oxygen in', cls: 'ox', at: pumpAt('inlet'), vis: pf('oxygen') })
  labels.add({ id: 'p-ind', text: 'Inducer', cls: 'ox', at: pumpAt('inducer'), vis: pf('oxygen') })
  labels.add({ id: 'p-imp', text: 'Impeller', cls: 'ox', at: pumpAt('impeller'), vis: pf('oxygen') })
  labels.add({ id: 'p-vol', text: 'Volute', cls: 'ox', at: pumpAt('volute'), vis: pf('oxygen') })
  labels.add({ id: 'p-dis', text: 'To the preburner', cls: 'ox', at: pumpAt('discharge'), vis: pf('oxygen') })
  labels.add({ id: 'p-brg', text: 'Bearings', at: pumpAt('bearings'), vis: pf() })
  labels.add({ id: 'p-hot', text: 'Hot gas in', cls: 'gas', at: pumpAt('hotgas'), vis: pf('gas') })
  labels.add({ id: 'p-sta', text: 'Stator vanes', cls: 'gas', at: pumpAt('stator'), vis: pf('gas') })
  labels.add({ id: 'p-tur', text: 'Turbine', cls: 'gas', at: pumpAt('turbine'), vis: pf('gas') })
  labels.add({ id: 'p-exh', text: 'To the injector', cls: 'gas', at: pumpAt('exhaust'), vis: pf('gas') })

  const tokAt = (name: string) => () => {
    const a = tok.anchors[name]
    if (!a) return null
    return a[0].localToWorld(a[1].clone())
  }
  const FU = () => (S.exhibit === 'fusion' ? 1 : 0)
  const fCut = () => FU() * (anim.fcut > 0.85 ? 1 : 0) * (anim.fexplode < 0.1 ? 1 : 0)
  const ff = (...kinds: string[]) => () => (S.fusion.follow === 'all' || kinds.includes(S.fusion.follow) ? fCut() : 0)
  const fExp = () => FU() * (anim.fexplode > 0.9 ? 1 : 0)
  labels.add({ id: 'f-plasma', text: 'Plasma', sub: () => `${Math.round(anim.ftemp)} million °C`, cls: 'plasma', at: tokAt('plasma'), vis: () => ff('plasma')() * (anim.fon > 0.3 ? 1 : 0) })
  labels.add({ id: 'f-cs', text: 'Central solenoid', cls: 'mag', at: tokAt('cs'), vis: () => Math.max(ff('magnets')(), fExp()) })
  labels.add({ id: 'f-tf', text: 'Toroidal field coils', sub: '18 of them', cls: 'mag', at: tokAt('tf'), vis: () => Math.max(ff('magnets')(), fExp(), FU() * (S.fusion.view === 'whole' && anim.fcut < 0.1 ? 1 : 0)) })
  labels.add({ id: 'f-pf', text: 'Poloidal field coil', cls: 'mag', at: tokAt('pf'), vis: () => Math.max(ff('magnets')(), fExp()) })
  labels.add({ id: 'f-vv', text: 'Vacuum vessel', at: tokAt('vessel'), vis: () => (S.fusion.follow === 'all' ? fCut() : 0) })
  labels.add({ id: 'f-bl', text: 'Blanket', sub: 'stops the neutrons', cls: 'heat', at: tokAt('blanket'), vis: () => (S.fusion.follow === 'neutrons' ? fCut() : 0) })
  labels.add({ id: 'f-dv', text: 'Divertor', sub: 'the exhaust', cls: 'heat', at: tokAt('divertor'), vis: () => ff('plasma', 'neutrons')() * (S.fusion.follow === 'all' ? 0 : 1) })
  labels.add({ id: 'f-nbi', text: 'Heating beam', cls: 'mag', at: tokAt('nbi'), vis: () => (S.fusion.follow === 'all' || S.fusion.follow === 'plasma' ? fCut() : 0) })
  const plantAt = (n: string) => () => plant.anchors[n].clone()
  const pw = () => (S.exhibit === 'fusion' && S.fusion.follow === 'power' ? 1 : 0)
  labels.add({ id: 'p-sg', text: 'Steam generator', cls: 'heat', at: plantAt('sg'), vis: pw })
  labels.add({ id: 'p-tu', text: 'Turbine', at: plantAt('turbine'), vis: pw })
  labels.add({ id: 'p-ge', text: 'Generator', cls: 'mag', at: plantAt('gen'), vis: pw })
  labels.add({ id: 'p-ci', text: 'The city', sub: () => `${Math.round((FUSION.state(anim.ftemp).fusion * anim.fon * 1.15 * 0.35 * 1000) / 1.5 / 1000)}k homes`, cls: 'heat', at: plantAt('city'), vis: pw })
  labels.add({ id: 'f-heat', text: 'Hot water out', cls: 'heat', at: tokAt('heat'), vis: () => (S.fusion.follow === 'neutrons' ? fCut() : 0) })
  const lineAt = (name: string, dy = 0) => () => {
    const a = line.anchors[name]
    if (!a) return null
    return a[0].localToWorld(a[1].clone()).add(new THREE.Vector3(0, dy, 0))
  }
  const LI = () => (S.exhibit === 'line' ? 1 : 0)
  STATIONS.forEach((st, s) => {
    labels.add({
      id: 'l-s' + s,
      text: st.name,
      sub: () => {
        const ms = line.sim.stations[s]
        if (ms.some((m) => m.state === 'down')) return 'broken down'
        if (s === line.bottleneck && line.bottleneckGlow > 0.5) return 'bottleneck'
        if (ms.every((m) => m.state === 'blocked')) return 'blocked'
        if (ms.every((m) => m.state === 'idle')) return 'waiting'
        return `${Math.round(line.sim.cycleOf(s))} s each`
      },
      cls: '',
      at: lineAt('s' + s, s % 2 ? 0.06 : 0),
      vis: LI,
    })
  })

  const carAt = (name: string, dy = 0) => () => {
    const a = truck.anchors[name]
    if (!a) return null
    return a[0].localToWorld(a[1].clone()).add(new THREE.Vector3(0, dy, 0))
  }
  const CA = () => (S.exhibit === 'car' ? 1 : 0)
  const inside = () => CA() * (anim.cxray > 0.97 || anim.cexplode > 0.9 ? 1 : 0)
  const cf = (...kinds: string[]) => () => (S.car.follow === 'all' || kinds.includes(S.car.follow) ? inside() : 0)
  labels.add({ id: 'c-pack', text: 'Battery', sub: '1,344 cells', cls: 'ox', at: carAt('pack'), vis: cf('energy', 'structure') })
  labels.add({ id: 'c-mf', text: 'Front motor', cls: 'heat', at: carAt('motorF'), vis: cf('motors', 'energy') })
  labels.add({ id: 'c-mr', text: 'Rear motors', sub: 'two', cls: 'heat', at: carAt('motorR'), vis: cf('motors', 'energy') })
  labels.add({ id: 'c-cf', text: 'Front casting', cls: 'fire', at: carAt('castF'), vis: () => (S.car.follow === 'structure' ? inside() : 0) })
  labels.add({ id: 'c-cr', text: 'Rear casting', cls: 'fire', at: carAt('castR'), vis: () => (S.car.follow === 'structure' ? inside() : 0) })
  labels.add({ id: 'c-sus', text: 'Air spring', at: carAt('suspension'), vis: () => (S.car.follow === 'all' ? inside() : 0) })
  labels.add({ id: 'c-rack', text: 'Steer by wire', at: carAt('rack'), vis: () => (S.car.follow === 'all' ? inside() * (anim.cexplode < 0.1 ? 1 : 0) : 0) })
  labels.add({ id: 'c-shell', text: 'Stainless exoskeleton', cls: 'fire', at: carAt('shell'), vis: () => CA() * (S.car.follow === 'structure' || anim.cexplode > 0.9 ? 1 : 0) })
  labels.add({ id: 'c-cab', text: 'Five seats', at: carAt('cabin'), vis: () => CA() * (anim.cexplode > 0.9 ? 1 : 0) })
  labels.add({ id: 'c-roll', text: 'Dyno rollers', sub: () => `${Math.round(anim.cv)} km/h`, at: () => new THREE.Vector3(CAR_POS.x + TR.axF + 0.2, DECK + 0.05, CAR_POS.z + TR.track + 0.35), vis: () => CA() * (S.car.view === 'whole' && S.car.follow === 'all' ? 1 : 0) })
  const duAt = (name: string) => () => {
    const a = du.anchors[name]
    if (!a) return null
    return a[0].localToWorld(a[1].clone())
  }
  const botAt = (n: string) => () => { const a = bot.anchors[n]; return a ? a[0].localToWorld(a[1].clone()) : null }
  const RO = () => (S.exhibit === 'robot' ? 1 : 0)
  const rIn = () => RO() * (anim.rxray > 0.9 || anim.rexplode > 0.9 ? 1 : 0)
  const rf = (...k: string[]) => () => (S.robot.follow === 'all' || k.includes(S.robot.follow) ? rIn() : 0)
  labels.add({ id: 'r-knee', text: 'Knee actuator', sub: () => `${Math.round(anim.rknee)} Nm`, cls: 'heat', at: botAt('knee'), vis: rf('actuators') })
  labels.add({ id: 'r-hip', text: 'Hip actuator', cls: 'heat', at: botAt('hip'), vis: () => (S.robot.follow === 'actuators' ? rIn() : 0) })
  labels.add({ id: 'r-bat', text: 'Battery', sub: '2.3 kWh', cls: 'mag', at: botAt('battery'), vis: rf('power') })
  labels.add({ id: 'r-cpu', text: 'Computer', at: botAt('computer'), vis: () => (S.robot.follow === 'all' || S.robot.follow === 'power' ? rIn() : 0) })
  labels.add({ id: 'r-hand', text: 'Tendon driven hand', cls: 'mag', at: botAt('hand'), vis: rf('hands') })
  labels.add({ id: 'r-eyes', text: 'Cameras', at: botAt('head'), vis: () => (S.robot.follow === 'all' ? rIn() : 0) })
  labels.add({ id: 'r-elbow', text: 'Elbow', at: botAt('elbow'), vis: () => (S.robot.follow === 'actuators' ? rIn() : 0) })
  const specNames: [string, number][] = [['Output flange', 1], ['Torque sensor', -1], ['Crossed roller bearing', 1], ['Circular spline', -1], ['Flexspline', 1], ['Wave generator', -1], ['Stator', 1], ['Rotor', -1], ['Encoder', 1], ['Motor', -1], ['Roller screw nut', 1], ['Planetary roller screw', -1], ['Push rod', 1]]
  const sbox = new THREE.Box3()
  for (const [n, side] of specNames) {
    labels.add({
      id: 'spec-' + n, text: n, cls: n === 'Stator' || n === 'Rotor' || n === 'Motor' ? 'heat' : n.includes('screw') || n.includes('spline') || n.includes('Wave') ? 'mag' : '',
      at: () => { const g = spec.anchor(n); if (!g) return null; sbox.setFromObject(g); const c = sbox.getCenter(new THREE.Vector3()); c.y += side * (n === 'Motor' || n.includes('screw') || n === 'Push rod' || n.includes('nut') ? 0.09 : 0.2); return c },
      vis: () => (S.exhibit === 'robot' && S.robot.view === 'actuator' && anim.rspec > 0.95 ? 1 : 0),
    })
  }
  const holeW = (p: THREE.Vector3) => p.clone().divideScalar(PORTAL.scale).add(portal.centre())
  const HO = () => (S.exhibit === 'hole' && HOLE.inside.value < 0.5 ? 1 : 0)
  labels.add({ id: 'h-shadow', text: 'Shadow', sub: '2.6 × the horizon', at: () => holeW(new THREE.Vector3(-2.2, -1.9, 0)), vis: () => HO() * (S.hole.view === 'bh' && S.hole.mode === 'watch' ? 1 : 0) })
  labels.add({ id: 'h-ring', text: 'Photon ring', cls: 'mag', at: () => holeW(new THREE.Vector3(1.4, 2.4, 0)), vis: () => HO() * (S.hole.view === 'bh' && S.hole.mode === 'watch' ? 1 : 0) })
  labels.add({ id: 'h-disk', text: 'Accretion disk', sub: 'brighter coming toward us', cls: 'heat', at: () => holeW(new THREE.Vector3(-9.5, 0.4, 0)), vis: () => HO() * (S.hole.view === 'bh' && S.hole.mode === 'watch' ? 1 : 0) })
  labels.add({ id: 'h-probe', text: 'Probe', sub: () => `${(anim.probeR).toFixed(2)} × horizon`, at: () => holeW(new THREE.Vector3(HOLE.probe.value.x, HOLE.probe.value.y + 0.35, HOLE.probe.value.z)), vis: () => HO() * (S.hole.mode === 'probe' ? 1 : 0) })
  labels.add({ id: 'h-throat', text: 'Throat', sub: 'another universe inside', cls: 'heat', at: () => holeW(new THREE.Vector3(1.2, 1.3, 0)), vis: () => HO() * (S.hole.view === 'wh' ? 1 : 0) })
  const jetAt = (n: string) => () => { const a = jet.anchors[n]; return a ? a[0].localToWorld(a[1].clone()) : null }
  const JE = () => (S.exhibit === 'jet' ? 1 : 0)
  const jIn = () => JE() * (anim.jcut > 0.85 && anim.jexp < 0.1 ? 1 : 0)
  const jf = (...k: string[]) => () => (S.jet.follow === 'all' || k.includes(S.jet.follow) ? jIn() : 0)
  labels.add({ id: 'j-fan', text: 'Fan', sub: '3 stages', cls: 'ox', at: jetAt('fan'), vis: jf('air', 'spools') })
  labels.add({ id: 'j-hpc', text: 'Compressor', sub: '6 stages', cls: 'gas', at: jetAt('hpc'), vis: jf('core', 'spools') })
  labels.add({ id: 'j-comb', text: 'Combustor', sub: () => `${Math.round((450 + (JET.tit - 450) * Math.pow(anim.jthr, 1.2)) / 10) * 10} °C`, cls: 'fire', at: jetAt('combustor'), vis: jf('fire') })
  labels.add({ id: 'j-turb', text: 'Turbines', sub: '1 high, 2 low', cls: 'fire', at: jetAt('turbine'), vis: jf('fire', 'spools') })
  labels.add({ id: 'j-ab', text: 'Afterburner', sub: 'fuel sprays from 22 curved vanes', cls: 'fire', at: jetAt('vanes'), vis: jf('fire') })
  labels.add({ id: 'j-noz', text: 'Variable nozzle', at: jetAt('nozzle'), vis: () => (S.exhibit === 'jet' && anim.jexp < 0.1 && (S.jet.follow === 'all' || anim.jab > 0.5) ? 1 : 0) })
  labels.add({ id: 'j-mix', text: 'Lobed mixer', sub: 'bypass folds into the core', cls: 'ox', at: jetAt('mixer'), vis: jf('air') })
  labels.add({ id: 'j-igv', text: 'Hollow titanium blisk', sub: 'blades and disc in one piece', at: jetAt('igv'), vis: jf('air') })
  labels.add({ id: 'j-agb', text: 'Gearbox', sub: 'fuel, oil and hydraulic pumps', at: jetAt('gearbox'), vis: () => JE() * (S.jet.view === 'whole' && anim.jab < 0.5 && S.jet.follow === 'all' ? 1 : 0) })
  for (const st of JET_STATIONS) {
    const k = st.t / 2000
    labels.add({
      id: `j-st-${st.name}`, text: st.name, sub: () => `${Math.round((15 + (st.t - 15) * (st.name === 'Afterburner' ? Math.max(0.44, anim.jab) : 1) * (0.55 + 0.45 * anim.jthr)) / 10) * 10} °C · ${(1 + (st.p - 1) * (0.3 + 0.7 * anim.jthr)).toFixed(st.p < 5 ? 1 : 0)} bar`,
      cls: k > 0.6 ? 'fire' : k > 0.2 ? 'heat' : 'ox',
      at: () => jet.root.localToWorld(new THREE.Vector3(-0.62, st.y, 0.3)), vis: () => JE() * (S.jet.follow === 'heat' ? jIn() : 0),
    })
  }
  labels.add({ id: 'j-diamond', text: 'Shock diamonds', cls: 'fire', at: () => new THREE.Vector3(JET_POS.x + JET.length + 1.24, JET_POS.y + 0.12, JET_POS.z), vis: () => JE() * (anim.jab > 0.8 ? 1 : 0) })
  const drAt = (n: string) => () => { const a = drone.anchors[n]; return a ? a[0].localToWorld(a[1].clone()) : null }
  const DE = () => (S.exhibit === 'drone' ? 1 : 0)
  const dWhole = () => DE() * (anim.dexp < 0.1 ? 1 : 0)
  MOTORS.forEach((mo, k) => labels.add({ id: 'd-m' + k, text: mo.name, sub: () => `${Math.round(dsim.rpm(k) / 10) * 10} rpm`, cls: mo.x > 0 ? 'fire' : 'gas', at: drAt('m' + k), vis: () => dWhole() * (S.drone.follow === 'control' ? 1 : 0) }))
  labels.add({ id: 'd-gim', text: 'Gimbal', sub: 'keeps the camera level', at: drAt('gimbal'), vis: () => dWhole() * (S.drone.mode === 'gust' || (S.drone.follow === 'all' && S.drone.mode === 'hover' && !S.drone.payload) ? 1 : 0) })
  labels.add({ id: 'd-bat', text: 'Batteries', sub: '2 × 263 Wh, hot swap', cls: 'heat', at: drAt('battery'), vis: () => dWhole() * (S.drone.follow === 'power' || (S.drone.follow === 'all' && S.drone.mode === 'hover' && !S.drone.payload) ? 1 : 0) })
  labels.add({ id: 'd-rtk', text: 'RTK GPS', sub: 'about 1 cm', at: drAt('rtk'), vis: () => dWhole() * (S.drone.follow === 'sensors' ? 1 : 0) })
  labels.add({ id: 'd-eyes', text: 'Stereo cameras', sub: 'on all six sides', cls: 'ox', at: drAt('eyes'), vis: () => dWhole() * (S.drone.follow === 'sensors' ? 1 : 0) })
  labels.add({ id: 'd-fc', text: 'Flight controller', sub: 'IMU inside', cls: 'gas', at: drAt('fc'), vis: () => DE() * (anim.dcut > 0.8 && anim.dexp < 0.1 ? 1 : 0) })
  labels.add({ id: 'd-comp', text: 'Compute', sub: 'vision and planning', at: drAt('compute'), vis: () => DE() * (anim.dcut > 0.8 && anim.dexp < 0.1 && S.drone.follow !== 'power' ? 1 : 0) })
  const f1At = (n: string) => () => { const a = f1.anchors[n]; return a ? a[0].localToWorld(a[1].clone()) : null }
  const FE = () => (S.exhibit === 'f1' ? 1 : 0)
  const fWhole = () => FE() * (anim.f1exp < 0.1 && anim.f1cut < 0.1 ? 1 : 0)
  const f1CutV = () => FE() * (anim.f1cut > 0.85 && anim.f1exp < 0.1 ? 1 : 0)
  const f1f = (...k: string[]) => () => (S.f1.follow === 'all' || k.includes(S.f1.follow) ? 1 : 0)
  labels.add({ id: 'f-fw', text: 'Front wing', sub: 'two flaps move', cls: 'ox', at: f1At('frontWing'), vis: () => fWhole() * f1f('air')() * (S.f1.mode !== 'brake' ? 1 : 0) })
  labels.add({ id: 'f-rw', text: 'Rear wing', sub: () => (anim.f1open > 0.5 ? 'flap open: straight mode' : 'flap closed: corner mode'), cls: 'ox', at: f1At('rearWing'), vis: () => fWhole() * f1f('air', 'pressure')() * (S.f1.mode !== 'brake' ? 1 : 0) })
  labels.add({ id: 'f-floor', text: 'Floor tunnels', sub: 'most of the downforce', cls: 'gas', at: f1At('under'), vis: () => fWhole() * (S.f1.follow === 'air' || S.f1.follow === 'pressure' ? 1 : 0) })
  labels.add({ id: 'f-diff', text: 'Diffuser', cls: 'gas', at: f1At('diffuser'), vis: () => fWhole() * (S.f1.follow === 'air' ? 1 : 0) })
  labels.add({ id: 'f-vort', text: 'Tip vortex', at: f1At('vortex'), vis: () => fWhole() * (S.f1.follow === 'air' ? 1 : 0) })
  labels.add({ id: 'f-halo', text: 'Halo', sub: 'titanium, takes about 12 tonnes', at: f1At('halo'), vis: () => fWhole() * (S.f1.follow === 'all' && S.f1.mode === 'corner' ? 1 : 0) })
  labels.add({ id: 'f-pod', text: 'Sidepod', sub: 'radiators inside', at: f1At('pod'), vis: () => fWhole() * (S.f1.follow === 'all' && S.f1.mode === 'corner' ? 1 : 0) })
  labels.add({ id: 'f-brake', text: 'Carbon brakes', sub: 'about 1,000 °C', cls: 'fire', at: f1At('brake'), vis: () => FE() * (anim.f1brake > 0.5 && anim.f1exp < 0.1 ? 1 : 0) })
  labels.add({ id: 'f-eng', text: 'V6 engine', sub: '1.6 litres, about 400 kW', cls: 'fire', at: f1At('engine'), vis: () => f1CutV() * f1f('power')() })
  labels.add({ id: 'f-mguk', text: 'Electric motor', sub: '350 kW', cls: 'ox', at: f1At('mguk'), vis: () => f1CutV() * f1f('power')() })
  labels.add({ id: 'f-bat', text: 'Battery', cls: 'ox', at: f1At('battery'), vis: () => f1CutV() * f1f('power')() })
  labels.add({ id: 'f-fuel', text: 'Fuel tank', sub: 'sustainable fuel', cls: 'heat', at: f1At('fuel'), vis: () => f1CutV() * f1f('power')() })
  labels.add({ id: 'f-gear', text: 'Gearbox', sub: '8 speeds', at: f1At('gearbox'), vis: () => f1CutV() * f1f('power')() })
  labels.add({ id: 'f-turbo', text: 'Turbo', cls: 'fire', at: f1At('turbo'), vis: () => f1CutV() * (S.f1.follow === 'power' ? 1 : 0) })
  labels.add({ id: 'f-pist', text: 'Pistons and crank', sub: '80 mm bore, 53 mm stroke', cls: 'fire', at: f1At('pistons'), vis: () => f1CutV() * (S.f1.follow === 'all' ? 1 : 0) })
  labels.add({ id: 'f-ic', text: 'Intercooler', cls: 'ox', at: f1At('intercooler'), vis: () => f1CutV() * (S.f1.follow === 'power' ? 1 : 0) })
  labels.add({ id: 'f-ce', text: 'Control electronics', sub: 'drives the motor', cls: 'ox', at: f1At('ce'), vis: () => f1CutV() * (S.f1.follow === 'power' ? 1 : 0) })
  labels.add({ id: 'f-loom', text: 'Wiring looms', sub: 'ECU to every sensor', at: f1At('looms'), vis: () => f1CutV() * (S.f1.follow === 'all' ? 1 : 0) })
  labels.add({ id: 'f-brk', text: 'Brake lines', sub: 'from the pedal to all four', cls: 'fire', at: f1At('brakes'), vis: () => f1CutV() * (S.f1.follow === 'all' ? 1 : 0) })
  labels.add({ id: 'f-sus', text: 'Front suspension', sub: 'springs and dampers inside the nose', at: f1At('suspension'), vis: () => f1CutV() * (S.f1.follow === 'all' ? 1 : 0) })
  labels.add({ id: 'f-oil', text: 'Oil tank', at: f1At('oil'), vis: () => f1CutV() * (S.f1.follow === 'all' ? 1 : 0) })
  labels.add({ id: 'f-rad', text: 'Radiator', at: f1At('radiator'), vis: () => f1CutV() * (S.f1.follow === 'all' ? 1 : 0) })
  const MO = () => (S.exhibit === 'motor' ? 1 : 0)
  const mCut = () => MO() * (anim.mcut > 0.9 ? 1 : 0) * (anim.mexplode < 0.1 ? 1 : 0)
  const mf = (...kinds: string[]) => () => (S.motor.follow === 'all' || kinds.includes(S.motor.follow) ? mCut() : 0)
  const mExp = () => MO() * (anim.mexplode > 0.9 ? 1 : 0)
  labels.add({ id: 'm-st', text: 'Stator', sub: '54 slots', cls: 'heat', at: duAt('stator'), vis: () => Math.max(mf('current')(), mExp()) })
  labels.add({ id: 'm-ro', text: 'Rotor', sub: 'six magnet poles', cls: 'plasma', at: duAt('rotor'), vis: () => Math.max(mf('field')(), mExp()) })
  labels.add({ id: 'm-inv', text: 'Inverter', sub: 'DC to three phase', cls: 'ox', at: duAt('inverter'), vis: () => Math.max(mf('current')(), mExp(), MO() * (S.motor.view === 'whole' ? 1 : 0)) })
  labels.add({ id: 'm-gear', text: 'Final gear', sub: '72 teeth', cls: 'fire', at: duAt('gears'), vis: () => MO() * (S.motor.follow === 'gears' || anim.mexplode > 0.9 ? 1 : 0) })
  labels.add({ id: 'm-diff', text: 'To the wheel', at: duAt('diff'), vis: () => MO() * (S.motor.follow === 'gears' && anim.mexplode < 0.1 ? 1 : 0) })

  /* ---------------- hotspots: click a machine from anywhere in the hall ---------------- */
  const spotsEl = document.createElement('div')
  spotsEl.id = 'spots'
  document.getElementById('app')!.appendChild(spotsEl)
  const SPOT_TEXT: Record<string, [string, string, THREE.Vector3]> = {
    fusion: ['Fusion reactor', 'a star in a bottle', new THREE.Vector3(FUSION_POS.x, TOKAMAK_MID + 1.7, FUSION_POS.z)],
    engine: ['Raptor 3', 'rocket engine', new THREE.Vector3(-0.6, 2.2, 0)],
    pump: ['Turbopump', 'oxygen side', new THREE.Vector3(PUMP_POS.x, PUMP_POS.y + 0.9, PUMP_POS.z)],
    line: ['Production line', 'find the bottleneck', new THREE.Vector3(LINE_POS.x, 3.0, LINE_POS.z - 0.9)],
    car: ['Cybertruck', 'full size, on a dyno', new THREE.Vector3(CAR_POS.x, 2.6, CAR_POS.z)],
    motor: ['Drive unit', 'how a motor turns', new THREE.Vector3(DRIVE_POS.x, DRIVE_POS.y + 1.0, DRIVE_POS.z)],
    robot: ['Humanoid', 'a walking robot', new THREE.Vector3(ROBOT_POS.x, 2.5, ROBOT_POS.z)],
    hole: ['Black hole', 'through a portal', new THREE.Vector3(HOLE_POS.x, 4.6, HOLE_POS.z)],
    drone: ['Drone', 'in a flight cage', new THREE.Vector3(DRONE_POS.x, 3.0, DRONE_POS.z)],
    f1: ['F1 car', '2026, in a wind tunnel', new THREE.Vector3(F1_POS.x, 2.2, F1_POS.z)],
    jet: ['Jet engine', 'with afterburner', new THREE.Vector3(JET_POS.x + 2.8, 4.0, JET_POS.z)],
  }
  const spots = EXHIBITS.map((ex) => {
    const b = document.createElement('button')
    b.className = 'spot'
    b.dataset.ex = ex
    b.innerHTML = `<b>${SPOT_TEXT[ex][0]}<i>${SPOT_TEXT[ex][1]}</i></b><s></s>`
    b.addEventListener('click', () => ui.setExhibit(ex))
    spotsEl.appendChild(b)
    return { ex, el: b, at: SPOT_TEXT[ex][2] }
  })
  const sv = new THREE.Vector3()
  const updateSpots = () => {
    const k = anim.hall
    spotsEl.style.display = k > 0.01 ? '' : 'none'
    if (k <= 0.01) return
    for (const sp of spots) {
      sv.copy(sp.at).project(camera)
      const inFront = sv.z < 1
      sp.el.style.opacity = (inFront ? k : 0).toFixed(3)
      sp.el.style.pointerEvents = inFront && k > 0.5 ? 'auto' : 'none'
      sp.el.style.transform = `translate(${((sv.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-sv.y * 0.5 + 0.5) * H).toFixed(1)}px) translate(-50%, -100%)`
    }
  }
  // clicking a machine in the 3D view flies to it
  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const pick = (e: PointerEvent): Exhibit | null => {
    const r = canvas.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
    let best: Exhibit | null = null, bestT = Infinity
    for (const ex of EXHIBITS) {
      const h = HOME[ex]
      const sph = new THREE.Sphere(h.center, h.r)
      const hit = ray.ray.intersectSphere(sph, new THREE.Vector3())
      if (!hit) continue
      const t = hit.distanceTo(camera.position)
      if (t < bestT) { bestT = t; best = ex }
    }
    return best
  }
  let downAt: { x: number; y: number; t: number } | null = null
  canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() } })
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt || director.active) return
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
    const quick = performance.now() - downAt.t < 350
    downAt = null
    if (moved > 5 || !quick) return
    const ex = pick(e)
    if (ex && ex !== S.exhibit) ui.setExhibit(ex)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons) return
    const ex = pick(e)
    canvas.classList.toggle('pick', !!ex && ex !== S.exhibit)
  })

  /* ---------------- sizing and quality ---------------- */
  // Render budget in pixels. The canvas is upscaled by the browser when the
  // window has more pixels than the budget; the adaptive loop trims it further
  // on slower machines and gives it back when there is headroom.
  const dprCap = Number(params.get('dpr') ?? 2)
  let budget = Number(params.get('px') ?? (quality === 'high' ? 1.9e6 : quality === 'mid' ? 1.1e6 : 0.7e6))
  const budgetMax = budget
  let dpr = 1
  let W = 1, H = 1
  // On a phone the readout covers the top and the controls the bottom: centre the view in what is left.
  let freeShift = 0
  const frameFree = () => {
    let shift = 0
    if (W <= 760) {
      const ro = document.getElementById('readout')
      const panel = Array.from(document.querySelectorAll<HTMLElement>('.panel')).find((p) => !p.hidden)
      const nav = document.getElementById('exhibits')
      const top = ro && !ro.hidden ? ro.getBoundingClientRect().bottom : 60
      const bottom = panel ? panel.getBoundingClientRect().top : nav ? nav.getBoundingClientRect().top : H
      if (bottom > top + 80) shift = Math.round(H / 2 - (top + bottom) / 2)
    }
    if (shift === freeShift && (shift !== 0) === !!camera.view?.enabled) return
    freeShift = shift
    if (shift) camera.setViewOffset(W, H, 0, shift, W, H)
    else camera.clearViewOffset()
  }
  const resize = () => {
    W = window.innerWidth
    H = window.innerHeight
    const fit = Math.sqrt(budget / Math.max(1, W * H))
    dpr = params.get('rs') ? Number(params.get('rs')) : Math.max(0.5, Math.min(window.devicePixelRatio || 1, dprCap, fit))
    renderer.setPixelRatio(dpr)
    renderer.setSize(W, H, false)
    canvas.style.width = W + 'px'
    canvas.style.height = H + 'px'
    camera.aspect = W / H
    rig.scale = W / H < 1 ? Math.min(2.1, Math.sqrt(1.78 / (W / H))) : W / H < 1.4 ? 1.2 : 1
    frameFree()
    camera.updateProjectionMatrix()
    pipeline.setSize(Math.round(W * dpr), Math.round(H * dpr))
  }
  window.addEventListener('resize', resize)
  resize()
  // the first shot again, now that the rig knows the screen shape
  rig.set(params.get('shot') || HOME[S.exhibit].shot)

  const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt))

  /* ---------------- simulation step ---------------- */
  let simT = 0
  let frameNo = 0
  let lastDt = 1 / 60
  const step = (dt: number) => {
    simT += dt
    lastDt = dt
    const t = simT
    rig.update(dt)
    director.update(t)
    const Eng = S.engine
    anim.cut = approach(anim.cut, Eng.view === 'whole' ? 0 : 1, 2.8, dt)
    anim.explode = approach(anim.explode, Eng.view === 'exploded' ? 1 : 0, 2.6, dt)
    anim.throttle = approach(anim.throttle, Eng.throttle, 2.2, dt)
    anim.alt = approach(anim.alt, Eng.alt, 1.3, dt)
    anim.on = approach(anim.on, Eng.running && Eng.view !== 'exploded' ? 1 : 0, 3, dt)
    const moving = Math.abs(anim.cut - (Eng.view === 'whole' ? 0 : 1)) > 0.001 || Math.abs(anim.explode - (Eng.view === 'exploded' ? 1 : 0)) > 0.001
    raptor.cut.amount = anim.cut
    raptor.cut.update()
    if (moving || frameNo % 30 === 0) pipeline.shadowDirty = true
    frameNo++
    const capsE = raptor.cut.capsOn
    for (const fm of raptor.fluids) fm.visible = capsE || fm.userData.fluid === 'fire'
    raptor.update(dt, anim.explode, anim.on * (0.35 + 0.65 * anim.throttle))
    FLUID_TIME.value = t
    FLUID_RATE.value = 0.35 + 0.65 * anim.throttle
    FLUID_ON.value = 0.3 + 0.7 * anim.on
    const f = Eng.follow
    const emph = (k: string) => (f === 'all' ? 1 : k === f ? 1.7 : 0.1)
    FLUIDS.lox.emph.value = approach(FLUIDS.lox.emph.value, emph('oxygen'), 4, dt)
    FLUIDS.oxgas.emph.value = approach(FLUIDS.oxgas.emph.value, emph('oxygen'), 4, dt)
    FLUIDS.ch4.emph.value = approach(FLUIDS.ch4.emph.value, emph('methane'), 4, dt)
    FLUIDS.fuelgas.emph.value = approach(FLUIDS.fuelgas.emph.value, emph('methane'), 4, dt)
    FLUIDS.fire.emph.value = approach(FLUIDS.fire.emph.value, f === 'all' || f === 'fire' ? 1 : 0.22, 4, dt)
    raptor.mats.face.emissiveIntensity = 0.9 * anim.on * (0.5 + 0.5 * anim.throttle)
    plume.update(dt, t, anim.throttle, anim.alt, anim.on)
    room.update(t, anim.on)

    const Pm = S.pump
    Pm.modeT += dt
    let speedT = Pm.speed
    let gasGlow = 1
    let cav = 0
    if (Pm.mode === 'start') {
      const m = Pm.modeT
      speedT = m < 1.3 ? 0.3 * (m / 1.3) : m < 3.4 ? 0.3 + 0.7 * ((m - 1.3) / 2.1) : 1
      gasGlow = m < 1.3 ? 0.15 : 1
      anim.pflash = m > 1.3 && m < 1.9 ? Math.sin(((m - 1.3) / 0.6) * Math.PI) : 0
    } else if (Pm.mode === 'cav') {
      cav = 1
      speedT = Pm.speed * (1 + 0.035 * Math.sin(t * 9.0) + 0.02 * Math.sin(t * 23.0))
      anim.pflash = 0
    } else anim.pflash = 0
    anim.pspeed = Pm.mode === 'start' ? speedT : approach(anim.pspeed, speedT, 3, dt)
    anim.pcav = approach(anim.pcav, cav, 3, dt)
    anim.pcut = approach(anim.pcut, Pm.view === 'whole' ? 0 : 1, 2.8, dt)
    anim.pexplode = approach(anim.pexplode, Pm.view === 'exploded' ? 1 : 0, 2.6, dt)
    pump.cut.amount = anim.pcut
    pump.cut.update()
    for (const fm of pump.fluids) fm.visible = pump.cut.capsOn
    if (Math.abs(anim.pexplode - (Pm.view === 'exploded' ? 1 : 0)) > 0.001) pipeline.shadowDirty = true
    pump.update(dt, t, anim.pspeed, anim.pexplode, Pm.strobe, anim.pcav)
    PUMP_FLUID.rate.value = anim.pspeed * (1 - anim.pcav * 0.35)
    PUMP_FLUID.on.value = 0.15 + 0.85 * Math.min(1, anim.pspeed * 1.5)
    const pfo = Pm.follow
    const cavFlick = 1 - anim.pcav * (0.35 + 0.35 * Math.sin(t * 17.0) * Math.sin(t * 5.3))
    PUMP_FLUID.emph.lox.value = approach(PUMP_FLUID.emph.lox.value, (pfo === 'all' || pfo === 'oxygen' ? (pfo === 'oxygen' ? 1.5 : 1) : 0.12) * cavFlick, 4, dt)
    PUMP_FLUID.emph.oxgas.value = approach(PUMP_FLUID.emph.oxgas.value, (pfo === 'all' || pfo === 'gas' ? (pfo === 'gas' ? 1.6 : 1) : 0.12) * gasGlow + anim.pflash * 3, 6, dt)

    /* ---- fusion ---- */
    const Fs = S.fusion
    Fs.modeT += dt
    let onT = 1, shiftT = 0, sizeT = 1, flash = 0, tempT = Fs.temp
    if (Fs.mode === 'start') {
      const m = Fs.modeT
      // gas puff, breakdown fills the vessel, the plasma pulls in and heats
      onT = m < 0.5 ? 0 : m < 0.9 ? 0.5 : 1
      sizeT = m < 1.2 ? 1.14 : 1
      tempT = m < 1.2 ? 15 : Fs.temp
      flash = m > 0.5 && m < 0.9 ? Math.sin(((m - 0.5) / 0.4) * Math.PI) * 0.6 : 0
      if (m < 0.05) { anim.fon = 0; anim.ftemp = 15; anim.fsize = 1.14 }
      if (m > 6) { Fs.mode = 'run'; Fs.modeT = 0; changed() }
    } else if (Fs.mode === 'disrupt') {
      const m = Fs.modeT
      // the plasma wobbles, drifts up into the wall, dumps its energy and is gone
      anim.fwobble = m < 1.6 ? Math.min(1, m / 1.2) : 0
      shiftT = m < 1.6 ? 0.1 + 0.5 * Math.pow(Math.min(1, m / 1.6), 2) : 0.6
      onT = m < 1.6 ? 1 : 0
      flash = m > 1.55 && m < 2.3 ? Math.exp(-(m - 1.55) * 5) * 2.2 : 0
      if (m > 5.2) { Fs.mode = 'start'; Fs.modeT = 0; changed() }
    }
    if (Fs.mode !== 'disrupt') anim.fwobble = approach(anim.fwobble, 0, 3, dt)
    anim.fcut = approach(anim.fcut, Fs.view === 'whole' ? 0 : 1, 2.6, dt)
    anim.fexplode = approach(anim.fexplode, Fs.view === 'exploded' ? 1 : 0, 2.4, dt)
    anim.ftemp = approach(anim.ftemp, tempT, Fs.mode === 'start' ? 0.7 : 2.0, dt)
    anim.fon = approach(anim.fon, onT * (Fs.view === 'exploded' ? 0 : 1), Fs.mode === 'disrupt' ? 30 : 2.5, dt)
    anim.fshift = approach(anim.fshift, shiftT, Fs.mode === 'disrupt' ? 6 : 2, dt)
    anim.fsize = approach(anim.fsize, sizeT, 1.6, dt)
    anim.fflash = Math.max(flash, approach(anim.fflash, 0, 4, dt))
    tok.cut.amount = anim.fcut
    tok.cut.update()
    const fst = FUSION.state(anim.ftemp)
    const ffrac = Math.min(1.6, fst.fusion / 500) * anim.fon
    const wob = anim.fwobble * (0.06 * Math.sin(t * 23) + 0.04 * Math.sin(t * 37))
    PLASMA.time.value = t
    PLASMA.temp.value = anim.ftemp / 150
    PLASMA.on.value = anim.fon
    PLASMA.shift.value = anim.fshift + wob
    PLASMA.size.value = anim.fsize
    PLASMA.flash.value = anim.fflash
    GLOW_TIME.value = t
    const fo = Fs.follow
    const fe = (all: number, plasma: number, magnets: number, neutrons: number) => (fo === 'all' ? all : fo === 'plasma' ? plasma : fo === 'magnets' ? magnets : neutrons)
    const fe5 = (all: number, plasma: number, magnets: number, neutrons: number, power: number) => (fo === 'power' ? power : fe(all, plasma, magnets, neutrons))
    PLASMA.emph.value = approach(PLASMA.emph.value, fe5(1, 1.25, 0.3, 0.35, 1.1), 4, dt)
    TK_EMPH.field.value = approach(TK_EMPH.field.value, fe(0.3, 0.55, 1.4, 0.05) * (0.3 + 0.7 * anim.fon), 4, dt)
    TK_EMPH.coils.value = approach(TK_EMPH.coils.value, fe(0.35, 0.12, 1.7, 0.1), 4, dt)
    TK_EMPH.neutrons.value = approach(TK_EMPH.neutrons.value, fe(0.35, 0.15, 0, 1.6), 4, dt)
    TK_EMPH.heat.value = approach(TK_EMPH.heat.value, fe5(0.3, 0.1, 0.05, 1.6, 1.4) * Math.min(1, ffrac * 1.2), 4, dt)
    const pk = Math.min(1.4, ffrac)
    PLANT.heat.value = approach(PLANT.heat.value, fe5(0.35, 0.1, 0.05, 0.9, 1.6) * pk, 4, dt)
    PLANT.steam.value = approach(PLANT.steam.value, fe5(0.3, 0.1, 0.05, 0.3, 1.4) * pk, 4, dt)
    PLANT.power.value = approach(PLANT.power.value, fe5(0.4, 0.1, 0.05, 0.3, 2.0) * pk, 4, dt)
    PLANT.rate.value = 0.3 + 0.7 * pk
    plant.update(dt, pk)
    const heatFrac = Math.min(1.5, fst.heating / 50)
    TK_EMPH.beam.value = approach(TK_EMPH.beam.value, fe(1, 1.2, 0.3, 0.2) * heatFrac * anim.fon, 4, dt)
    TK_RATE.beam.value = 0.6 + 0.4 * heatFrac
    tok.activity = Math.min(1, ffrac)
    tok.update(dt, anim.fexplode, ffrac, TK_EMPH.heat.value)
    {
      // the first wall picks up the plasma's pink glow; the blanket warms with the neutron flux
      const pink = 0.16 * anim.fon * Math.min(1.3, PLASMA.emph.value) * (0.25 + 0.75 * PLASMA.temp.value) + anim.fflash * 0.5
      const heat = 0.3 * TK_EMPH.heat.value
      tok.M.blanket.emissive.setRGB(1.0 * pink + 1.0 * heat, 0.22 * pink + 0.34 * heat, 0.62 * pink + 0.08 * heat)
      tok.M.blanket.emissiveIntensity = 1
    }
    {
      // in magnets mode the coil cases carry a cold blue glow
      const k = Math.max(0, TK_EMPH.coils.value - 0.35) * 0.06
      for (const m of [tok.M.coil, tok.M.pf, tok.M.cs]) {
        m.emissive.setRGB(0.25 * k, 0.6 * k, 1.0 * k)
        m.emissiveIntensity = 1
      }
    }
    const fMoving = Math.abs(anim.fexplode - (Fs.view === 'exploded' ? 1 : 0)) > 0.001 || Math.abs(anim.fcut - (Fs.view === 'whole' ? 0 : 1)) > 0.001
    if (fMoving) pipeline.shadowDirty = true

    /* ---- production line ---- */
    line.update(dt, t)

    /* ---- truck ---- */
    {
      const Cs = S.car
      Cs.modeT += dt
      let accel = 0 // m/s²
      const v = anim.cv / 3.6
      if (Cs.mode === 'launch') {
        const m = Cs.modeT
        if (m < dt * 1.5) { anim.cv = 0; anim.t100 = null }
        if (m < 0.6) accel = 0
        else if (anim.cv < 100) {
          accel = launchAccel(anim.cv)
          if (anim.cv + accel * 3.6 * dt >= 100 && anim.t100 === null) anim.t100 = m - 0.6
        } else accel = 0
        if (anim.t100 !== null && m > 0.6 + anim.t100 + 3.2) { Cs.mode = 'cruise'; Cs.speed = 100; Cs.modeT = 0; changed() }
      } else if (Cs.mode === 'steer') {
        const want = (20 - anim.cv) / 3.6
        accel = Math.max(-3, Math.min(1.5, want * 1.4))
      } else if (Cs.mode === 'regen') {
        const m = Cs.modeT
        if (m < dt * 1.5 && anim.cv < 60) anim.cv = Math.max(anim.cv, 60)
        accel = -3.2
        if (anim.cv < 6) { Cs.mode = 'cruise'; Cs.modeT = 0; changed() }
      } else {
        const want = (Cs.speed - anim.cv) / 3.6
        accel = Math.max(-3.0, Math.min(Math.max(0.2, launchAccel(anim.cv) * 0.35), want * 1.4))
        if (Math.abs(want) < 0.01) accel = 0
      }
      anim.cv = Math.max(0, Math.min(TRUCK.maxSpeed + 5, anim.cv + accel * 3.6 * dt))
      anim.ca = approach(anim.ca, accel, 8, dt)
      anim.wheel += visualSpin(v / TRUCK.wheelR) * dt
      anim.cxray = Math.max(0, Math.min(1, anim.cxray + (Cs.view === 'xray' ? 1 : -1) * dt * 0.62))
      anim.cexplode = approach(anim.cexplode, Cs.view === 'exploded' ? 1 : 0, 2.2, dt)
      const lo = load(anim.cv, anim.ca)
      const regen = lo.battery < -1 ? 1 : 0
      anim.regenK = approach(anim.regenK, regen, 5, dt)
      const f = Cs.follow
      const moving = Math.min(1, Math.abs(lo.battery) / 40)
      const opened = Math.max(anim.cxray, anim.cexplode)
      CAR_EMPH.energy.value = approach(CAR_EMPH.energy.value, (f === 'energy' ? 1.7 : f === 'all' ? 0.55 : 0.08) * (0.15 + 0.85 * moving) * opened, 4, dt)
      CAR_EMPH.energyRate.value = (regen ? -1 : 1) * (0.35 + Math.min(1.2, Math.abs(lo.battery) / 250))
      truck.setRegen(anim.regenK)
      truck.cellMat.emissive.setRGB(0.28 + 0.2 * anim.regenK, 0.78, 1.0 - 0.45 * anim.regenK)
      truck.cellMat.emissiveIntensity = approach(truck.cellMat.emissiveIntensity, f === 'energy' ? 0.55 * (0.4 + 0.6 * moving) : 0, 4, dt)
      const mk = f === 'motors' ? 1 : 0
      truck.M.housing.emissive.setRGB(1.0, 0.45, 0.12)
      truck.M.housing.emissiveIntensity = approach(truck.M.housing.emissiveIntensity, mk * 0.28, 4, dt)
      const sk = f === 'structure' ? 1 : 0
      truck.M.alu.emissive.setRGB(1.0, 0.72, 0.38)
      truck.M.alu.emissiveIntensity = approach(truck.M.alu.emissiveIntensity, sk * 0.22, 4, dt)
      truck.setDim(f === 'all' || f === 'structure' ? 1 : 0.55)
      truck.update(dt, anim.cexplode, anim.cxray, anim.wheel, anim.wheel * 2.5)
      anim.cride = approach(anim.cride, Cs.height === 'low' ? -0.09 : Cs.height === 'high' ? 0.14 : 0, 1.6, dt)
      const steerOn = Cs.mode === 'steer' ? 1 : 0
      anim.csteer = approach(anim.csteer, steerOn, 2, dt)
      const sw = Math.sin(Cs.modeT * 0.9)
      anim.clight = approach(anim.clight, Cs.view === 'whole' ? 1 : 0, 3, dt)
      truck.chassis(anim.cride, 0.42 * sw * anim.csteer, -0.17 * sw * anim.csteer, anim.clight, anim.regenK)
      room.bay.update(dt, v)
      if (Math.abs(anim.cexplode - (Cs.view === 'exploded' ? 1 : 0)) > 0.001 || (anim.cxray > 0 && anim.cxray < 1)) pipeline.shadowDirty = true
    }

    /* ---- drive unit ---- */
    {
      const Ms = S.motor
      anim.mrpm = approach(anim.mrpm, Ms.rpm, 1.6, dt)
      anim.mangle += ((anim.mrpm / 60) * Math.PI * 2 / 600) * dt
      anim.mtorque = approach(anim.mtorque, Ms.mode === 'drive' ? 1 : Ms.mode === 'regen' ? -1 : 0, 3, dt)
      anim.mcut = approach(anim.mcut, Ms.view === 'whole' ? 0 : 1, 2.6, dt)
      anim.mexplode = approach(anim.mexplode, Ms.view === 'exploded' ? 1 : 0, 2.4, dt)
      anim.mcover = approach(anim.mcover, Ms.follow === 'gears' && Ms.view !== 'whole' ? 1 : 0, 2.4, dt)
      const f = Ms.follow
      DU_EMPH.current.value = approach(DU_EMPH.current.value, f === 'current' ? 1.3 : f === 'all' ? 1 : f === 'field' ? 0.45 : 0.15, 4, dt)
      DU_EMPH.field.value = approach(DU_EMPH.field.value, (f === 'field' ? 1.4 : f === 'all' ? 0.8 : f === 'current' ? 0.25 : 0) * (Ms.mode === 'coast' ? 0.45 : 1), 4, dt)
      DU_EMPH.hv.value = approach(DU_EMPH.hv.value, (f === 'current' ? 1.4 : f === 'all' ? 0.6 : 0.1) * Math.abs(anim.mtorque), 4, dt)
      DU_EMPH.hvRate.value = Math.sign(anim.mtorque || 1) * (0.3 + anim.mrpm / 16000)
      const gk = f === 'gears' ? 1 : 0
      du.M.gear.emissive.setRGB(1.0, 0.7, 0.35)
      du.M.gear.emissiveIntensity = approach(du.M.gear.emissiveIntensity, gk * 0.16, 4, dt)
      du.cut.amount = anim.mcut
      du.cut.update()
      du.update(dt, anim.mexplode, anim.mangle, anim.mtorque, anim.mcover, anim.mcut)
      if (Math.abs(anim.mexplode - (Ms.view === 'exploded' ? 1 : 0)) > 0.001 || Math.abs(anim.mcut - (Ms.view === 'whole' ? 0 : 1)) > 0.001) pipeline.shadowDirty = true
    }

    /* ---- humanoid ---- */
    {
      const Rs = S.robot
      const mode = Rs.view === 'exploded' || Rs.view === 'actuator' ? 'stand' : Rs.mode
      anim.ramp = approach(anim.ramp, mode === 'walk' ? 1 : 0, 2.5, dt)
      anim.rphase += dt * Math.PI * 2 * 0.75 * Math.max(0.2, anim.ramp)
      if (mode === 'squat') anim.rsq += dt * Math.PI * 2 * 0.3
      else anim.rsq = approach(anim.rsq, 0, 3, dt)
      anim.rcarry = approach(anim.rcarry, Rs.payload > 0 ? 1 : 0, 3, dt)
      const target = gait(mode, mode === 'squat' ? anim.rsq : anim.rphase, 1, anim.rcarry, t)
      const k = 1 - Math.exp(-dt * 9)
      const cur = rPose
      for (const key of Object.keys(target) as (keyof Pose)[]) {
        const tv = target[key] as number | [number, number]
        if (Array.isArray(tv)) {
          const cv = cur[key] as [number, number]
          cv[0] += (tv[0] - cv[0]) * k
          cv[1] += (tv[1] - cv[1]) * k
        } else (cur as unknown as Record<string, number>)[key] += ((tv as number) - (cur[key] as number)) * k
      }
      bot.apply(cur)
      bot.box.visible = anim.rcarry > 0.5
      if (bot.box.visible) {
        const hc = bot.handsCenter()
        bot.box.position.set(hc.x, hc.y - bot.body.position.y - 0.07, hc.z + 0.02)
        const inv2 = new THREE.Matrix4().copy(bot.root.matrixWorld).invert()
        const lw = new THREE.Vector3().setFromMatrixPosition(bot.J.lWrist.matrixWorld).applyMatrix4(inv2)
        const rw = new THREE.Vector3().setFromMatrixPosition(bot.J.rWrist.matrixWorld).applyMatrix4(inv2)
        const s = 0.75 + 0.25 * Math.min(1, Rs.payload / 20)
        bot.box.scale.set(Math.max(0.2, Math.abs(lw.x - rw.x) - 0.045) / 0.3, s, s)
      }
      const walkV = 3 * anim.ramp
      stage.update(bot.beltStep)
      anim.rexplode = approach(anim.rexplode, Rs.view === 'exploded' ? 1 : 0, 2.4, dt)
      anim.rxray = approach(anim.rxray, Rs.view === 'xray' ? 1 : 0, 1.3, dt)
      bot.update(anim.rexplode, anim.rxray)
      anim.rspec = approach(anim.rspec, Rs.view === 'actuator' ? 1 : 0, 2.2, dt)
      spec.group.visible = anim.rspec > 0.01
      if (spec.group.visible) {
        spec.group.scale.setScalar(Math.min(1, anim.rspec * 1.6))
        anim.rspin += dt * 6
        spec.update(Math.max(0, (anim.rspec - 0.35) / 0.65), anim.rspin)
      }
      const depth = mode === 'squat' ? 0.5 - 0.5 * Math.cos(anim.rsq) : 0
      const L = robotLoad(mode, walkV, Rs.payload, depth)
      anim.rpower = approach(anim.rpower, L.power, 3, dt)
      anim.rknee = approach(anim.rknee, L.knee, 4, dt)
      const f = Rs.follow
      const act = f === 'actuators' ? 1 : f === 'all' ? (Rs.view === 'whole' ? 0.08 : 0.3) : 0.12
      anim.ract = approach(anim.ract, act, 4, dt)
      const kl = anim.rknee / 120
      const pl = Rs.payload / 20
      const loads: Partial<Record<Joint, number>> = {
        lKnee: kl, rKnee: kl, lHip: kl * 0.8 + pl * 0.2, rHip: kl * 0.8 + pl * 0.2, lAnkle: kl * 0.6, rAnkle: kl * 0.6,
        waist: 0.15 + pl * 0.7, neck: 0.08, lShoulder: 0.1 + pl * 0.9, rShoulder: 0.1 + pl * 0.9, lElbow: 0.1 + pl, rElbow: 0.1 + pl, lWrist: 0.05 + pl * 0.6, rWrist: 0.05 + pl * 0.6,
      }
      bot.setLoads(loads, anim.ract)
      BOT.power.value = approach(BOT.power.value, (f === 'power' ? 1.6 : f === 'all' ? 0.25 : 0.05) * (0.4 + anim.rpower / 600), 4, dt)
      BOT.rate.value = 0.4 + anim.rpower / 700
      BOT.tendon.value = approach(BOT.tendon.value, f === 'hands' ? 1.8 : 0.15, 4, dt)
      bot.cells.emissiveIntensity = approach(bot.cells.emissiveIntensity, f === 'power' ? 0.6 : 0, 4, dt)
      bot.setGhost(f === 'all' ? 1 : 0.6)
      // contact shadows follow the soles
      const inv = new THREE.Matrix4().copy(stage.mount.matrixWorld).invert()
      ;['lAnkle', 'rAnkle'].forEach((n, i) => {
        const p = new THREE.Vector3().setFromMatrixPosition(bot.J[n as Joint].matrixWorld).applyMatrix4(inv)
        footShadows[i].position.set(p.x, 0.004, p.z + 0.045)
        const lift = Math.max(0, p.y - 0.09)
        ;(footShadows[i].material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - lift * 8)
      })
    }

    /* ---- jet engine ---- */
    {
      const Js = S.jet
      anim.jthr = approach(anim.jthr, Js.throttle, 1.2, dt)
      anim.jab = approach(anim.jab, Js.ab && Js.view !== 'exploded' ? 1 : 0, Js.ab ? 2.5 : 4, dt)
      anim.jcut = approach(anim.jcut, Js.view === 'whole' ? 0 : 1, 2.6, dt)
      anim.jexp = approach(anim.jexp, Js.view === 'exploded' ? 1 : 0, 2.4, dt)
      const th = anim.jthr
      // visual spin rates: fast enough to read as spinning, slow enough not to strobe
      anim.jlp += dt * (2 + 9 * th)
      anim.jhp += dt * (3 + 13 * th)
      jet.cut.amount = anim.jcut
      jet.cut.update()
      for (const f of jet.flows) f.visible = jet.cut.capsOn
      jet.update(anim.jexp, anim.jlp, anim.jhp, anim.jab, 0.2 + 0.8 * th)
      const fo = Js.follow
      const fe = (all: number, air: number, core: number, fire: number, sp: number) => (fo === 'all' ? all : fo === 'air' ? air : fo === 'core' ? core : fo === 'fire' ? fire : fo === 'heat' ? 0.08 : sp)
      JET_FLOW.heat.value = approach(JET_FLOW.heat.value, fo === 'heat' && jet.cut.capsOn && anim.jexp < 0.1 ? 1 : 0, 3, dt)
      jet.heatMesh.visible = JET_FLOW.heat.value > 0.01
      JET_FLOW.time.value = t
      JET_FLOW.rate.value = 0.3 + 0.9 * th
      JET_FLOW.air.value = approach(JET_FLOW.air.value, fe(0.7, 1.8, 0.12, 0.12, 0.2) * (0.3 + 0.7 * th), 4, dt)
      JET_FLOW.core.value = approach(JET_FLOW.core.value, fe(0.7, 0.15, 1.8, 0.3, 0.2) * (0.3 + 0.7 * th), 4, dt)
      JET_FLOW.fire.value = approach(JET_FLOW.fire.value, fe(0.8, 0.12, 0.4, 1.9, 0.2) * (0.3 + 0.7 * th), 4, dt)
      const spK = fo === 'spools' ? 1 : 0
      jet.M.ti.emissive.setRGB(0.2 * spK, 0.5 * spK, 1.0 * spK)
      jet.M.ti.emissiveIntensity = 0.35
      const pm = jetPlume.material as THREE.ShaderMaterial
      pm.uniforms.uAB.value = anim.jab
      pm.uniforms.uDry.value = th * (1 - anim.jexp)
      jetPlume.visible = anim.jexp < 0.5
      jetLight.intensity = 35 * anim.jab * (0.85 + 0.15 * Math.sin(t * 37) * Math.sin(t * 13))
      if (Math.abs(anim.jexp - (Js.view === 'exploded' ? 1 : 0)) > 0.001 || Math.abs(anim.jcut - (Js.view === 'whole' ? 0 : 1)) > 0.001) pipeline.shadowDirty = true
    }

    /* ---- drone ---- */
    {
      const Ds = S.drone
      anim.dcut = approach(anim.dcut, Ds.view === 'cut' ? 1 : 0, 2.4, dt)
      anim.dexp = approach(anim.dexp, Ds.view === 'exploded' ? 1 : 0, 2.2, dt)
      const calm = Ds.view === 'exploded'
      const base = calm || Ds.mode === 'hover' ? 0 : Ds.mode === 'wind' ? 12 : 6 + 5 * (0.6 * Math.sin(t * 0.9) + 0.4 * Math.sin(t * 2.3 + 1.0))
      anim.dwind = approach(anim.dwind, base, Ds.mode === 'gust' ? 6 : 1.2, dt)
      const gz = Ds.mode === 'gust' && !calm ? 3 * Math.sin(t * 0.7 + 2) : 0
      const wind = new THREE.Vector3(anim.dwind, 0, gz)
      dsim.step(Math.min(dt, 0.05), wind, DR.mass + (Ds.payload ? DR.payload : 0))
      const omegas: number[] = []
      for (let k = 0; k < 4; k++) {
        const w = (dsim.rpm(k) * 2 * Math.PI) / 60
        omegas.push(w)
        droneAngles[k] += dt * visualSpin(w)
      }
      drone.cut.amount = anim.dcut
      drone.cut.update()
      drone.update(dsim, DRONE_POS, anim.dexp, droneAngles, omegas, t)
      for (const f of cage.fans) f.rotation.x += dt * visualSpin(anim.dwind * 3)
      const fo = Ds.follow
      DRONE_FLOW.rate.value = 0.6 + 0.4 * (dsim.watts() / 700)
      const out = anim.dexp < 0.1 ? 1 : 0
      DRONE_FLOW.air.value = approach(DRONE_FLOW.air.value, (fo === 'air' ? 1.5 : fo === 'all' ? 0.25 : 0) * out, 4, dt)
      DRONE_FLOW.tip.value = approach(DRONE_FLOW.tip.value, (fo === 'air' ? 1.3 : 0) * out, 4, dt)
      DRONE_FLOW.power.value = approach(DRONE_FLOW.power.value, (fo === 'power' ? 1.6 : 0), 4, dt)
      DRONE_FLOW.signal.value = approach(DRONE_FLOW.signal.value, (fo === 'control' ? 1.6 : fo === 'all' && anim.dcut > 0.5 ? 0.6 : 0), 4, dt)
      DRONE_FLOW.sense.value = approach(DRONE_FLOW.sense.value, (fo === 'sensors' ? 1.2 : 0) * out, 4, dt)
      DRONE_FLOW.wind.value = approach(DRONE_FLOW.wind.value, (anim.dwind / 12) * 1.3, 3, dt)
      for (const m of drone.flows) m.visible = (m.userData.kind === 'inner' ? DRONE_FLOW.power.value + DRONE_FLOW.signal.value + DRONE_FLOW.sense.value : DRONE_FLOW.air.value + DRONE_FLOW.tip.value) > 0.02
      for (const m of drone.senseMeshes) m.visible = DRONE_FLOW.sense.value > 0.02
      for (const m of drone.senseMeshes) if ((m.material as THREE.MeshBasicMaterial).opacity !== undefined && !(m.material as THREE.ShaderMaterial).isShaderMaterial) (m.material as THREE.MeshBasicMaterial).opacity = 0.05 * DRONE_FLOW.sense.value
      for (const m of cage.windLines) m.visible = DRONE_FLOW.wind.value > 0.02
      if (Math.abs(anim.dexp - (Ds.view === 'exploded' ? 1 : 0)) > 0.001 || Math.abs(anim.dcut - (Ds.view === 'cut' ? 1 : 0)) > 0.001) pipeline.shadowDirty = true
      else if (S.exhibit === 'drone') pipeline.shadowDirty = true
    }

    /* ---- F1 car ---- */
    {
      const Fs = S.f1
      anim.f1v = approach(anim.f1v, Fs.speed, 1.5, dt)
      anim.f1open = approach(anim.f1open, Fs.mode === 'straight' ? 1 : 0, 3, dt)
      anim.f1brake = approach(anim.f1brake, Fs.mode === 'brake' ? 1 : 0, Fs.mode === 'brake' ? 1.6 : 0.9, dt)
      anim.f1cut = approach(anim.f1cut, Fs.view === 'cut' ? 1 : 0, 2.4, dt)
      anim.f1exp = approach(anim.f1exp, Fs.view === 'exploded' ? 1 : 0, 2.2, dt)
      const v = anim.f1v / 3.6
      anim.f1wheel += dt * visualSpin(v / F1.Rr) * (anim.f1exp > 0.5 ? 0.3 : 1)
      const steer = Fs.mode === 'corner' ? 0.1 * Math.sin(t * 0.7) : 0
      f1.cut.amount = anim.f1cut
      f1.cut.update()
      f1.inner.intensity = 9 * anim.f1cut
      f1.pu.setGhost(anim.f1cut > 0.5, f1.cut)
      f1.update(anim.f1exp, anim.f1wheel, anim.f1open, anim.f1brake, steer, t)
      f1bay.belt.offset.y += dt * 3.2 * Math.tanh(v / 40)
      const fo = Fs.follow
      const q = Math.min(1.3, 0.35 + 0.65 * (anim.f1v / 300) ** 2)
      F1_FLOW.q.value = q
      F1_FLOW.rate.value = 0.35 + 0.9 * (anim.f1v / 300)
      const outside = anim.f1exp < 0.1 ? 1 : 0
      F1_FLOW.air.value = approach(F1_FLOW.air.value, (fo === 'all' ? 0.2 : fo === 'air' ? 1.3 : 0) * outside * (0.5 + 0.5 * q), 4, dt)
      F1_FLOW.under.value = approach(F1_FLOW.under.value, (fo === 'all' ? 0.25 : fo === 'air' ? 1.6 : 0) * outside * (0.4 + 0.6 * q) * (1 - 0.4 * anim.f1open), 4, dt)
      F1_FLOW.vortex.value = approach(F1_FLOW.vortex.value, (fo === 'air' ? 1.2 : 0) * outside * q * (1 - 0.6 * anim.f1open), 4, dt)
      const pk = (fo === 'power' ? 1.6 : fo === 'all' ? 0.7 : 0) * (anim.f1cut > 0.5 ? 1 : 0)
      F1_FLOW.power.value = approach(F1_FLOW.power.value, pk * (1 - anim.f1brake), 4, dt)
      F1_FLOW.harvest.value = approach(F1_FLOW.harvest.value, pk * anim.f1brake, 4, dt)
      for (const m of f1.flows) m.visible = F1_FLOW.air.value + F1_FLOW.under.value > 0.02
      for (const m of f1.powerLines) m.visible = anim.f1cut > 0.3
      f1.setPressure(fo === 'pressure' && anim.f1exp < 0.5)
      if (Math.abs(anim.f1exp - (Fs.view === 'exploded' ? 1 : 0)) > 0.001 || Math.abs(anim.f1cut - (Fs.view === 'cut' ? 1 : 0)) > 0.001) pipeline.shadowDirty = true
    }

    /* ---- black hole and wormhole ---- */
    {
      const Hs = S.hole
      Hs.modeT += dt
      anim.hopen = approach(anim.hopen, 1, 1.4, dt)
      anim.hpower = approach(anim.hpower, S.exhibit === 'hole' ? 1 : 0.45, 1.5, dt)
      anim.hspin += dt * (0.25 + 1.4 * anim.hpower)
      portal.update(t, anim.hspin, anim.hpower)
      HOLE.time.value = t
      HOLE.center.value.copy(portal.centre())
      HOLE.scale.value = PORTAL.scale
      HOLE.open.value = Math.min(1, anim.hopen)
      let targetMix = Hs.view === 'wh' ? 1 : 0
      let inside = 0, dark = 0, flash = 0, look = 1, side = 1
      let stage = 'watch'
      const cam = HOLE.cam.value
      const ease = (u: number) => { const k = Math.min(1, Math.max(0, u)); return k * k * (3 - 2 * k) }
      if (Hs.mode === 'dive') {
        const m = Hs.modeT
        if (m < dt * 1.5) { rig.fly('holeDoor', 2.6); anim.hdive = Hs.view === 'wh' ? 1 : 0 }
        stage = 'door'
        const d0 = (PORTAL.depth + 0.1) * PORTAL.scale
        const end = anim.hdive ? 13.0 : 21.0
        if (m >= 2.7 && m < end) {
          inside = 1
          if (!anim.hdive) {
            if (m < 11.7) {
              const e = Math.pow((m - 2.7) / 9, 2.3)
              const d = d0 + (0.97 - d0) * e
              cam.set(0.45 * (1 - e), 0.18 * (1 - e), d)
              dark = Math.min(1, Math.max(0, (1.35 - d) / 0.35))
              stage = d > 1.6 ? 'approach' : 'horizon'
              targetMix = 0
            } else if (m < 13.3) {
              cam.set(0, 0, 0.9); dark = 1; stage = 'inside'; targetMix = 0
            } else {
              const k = m - 13.3
              flash = k < 0.6 ? Math.sin((k / 0.6) * Math.PI) : 0
              dark = k < 0.3 ? 1 : 0
              targetMix = 1; side = -1; look = -1
              cam.set(0, 0, (-1.4 - 15 * ease((k - 0.2) / 7.2)) / 0.24)
              stage = k < 0.8 ? 'singularity' : 'other'
            }
          } else {
            const l = d0 + (-15 / 0.24 - d0) * ease((m - 2.7) / 9.8)
            cam.set(0, 0, Math.abs(l) < 0.02 ? -0.02 : l)
            side = l > 0 ? 1 : -1
            targetMix = 1
            stage = l > 1.5 ? 'approach' : 'other'
          }
        }
        if (m >= end - 0.35 && m < end + 0.35) flash = Math.max(flash, 1 - Math.abs(m - end) / 0.35)
        if (m >= end) {
          if (m < end + dt * 1.5) { rig.set(SHOTS.hole); Hs.view = 'wh' }
          if (m > end + 0.4) { Hs.mode = 'watch'; Hs.modeT = 0; changed() }
        }
      }
      anim.hmix = inside ? targetMix : approach(anim.hmix, targetMix, 2.2, dt)
      HOLE.mix.value = anim.hmix
      HOLE.inside.value = inside
      HOLE.dark.value = dark
      HOLE.flash.value = flash
      HOLE.look.value = look
      HOLE.side.value = side
      portal.fullscreen.visible = inside > 0
      anim.hstage = stage
      // the probe falls radially; seen from here it slows and freezes at the horizon
      if (Hs.mode === 'probe') {
        if (Hs.modeT < dt * 1.5) { anim.probeR = 9; anim.probeClock = 0 }
        const r = anim.probeR
        anim.probeR = Math.max(1.0004, r - (1 - 1 / r) * Math.sqrt(1 / r) * 2.6 * dt)
        anim.probeClock += dt * (1 - 1 / anim.probeR)
        const M = massOf(Hs.mass)
        const kS = Math.min(1, Math.max(0, (6.5 - Math.log10(M)) / 5.5))
        anim.probeStretch = 1 + kS * 9 / Math.pow(anim.probeR, 3)
        const dir = new THREE.Vector3(0.5, 0.18, 1).normalize()
        HOLE.probe.value.set(dir.x * anim.probeR, dir.y * anim.probeR, dir.z * anim.probeR, 0.24)
        HOLE.probeOn.value = 1
        HOLE.stretch.value = anim.probeStretch
      } else HOLE.probeOn.value = 0
    }

    /* ---- hall ---- */
    anim.hall = approach(anim.hall, S.exhibit === 'hall' ? 1 : 0, 4, dt)

    controls.update()
  }

  const dofOn = quality === 'high' || !!REC
  let bloomK = 0.06
  const render = () => {
    bloomK += ((S.exhibit === 'fusion' || S.exhibit === 'hole' || (S.exhibit === 'jet' && S.jet.ab) ? 0.12 : S.exhibit === 'motor' || (S.exhibit === 'car' && S.car.view === 'xray') ? 0.09 : 0.06) - bloomK) * 0.08
    pipeline.params.bloom = bloomK
    const above = camera.position.y > 5.15
    room.ceiling.visible = !above
    room.bay.ceiling.visible = !above
    pipeline.params.dofFocus = camera.position.distanceTo(controls.target)
    pipeline.params.dofAperture = dofOn && HOLE.inside.value < 0.5 ? 15 : 0
    if (HOLE.inside.value > 0.5) HOLE.invVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert()
    pipeline.render(scene, camera, plume, simT)
    labels.update(W, H, lastDt)
    updateSpots()
    ui.frame(live())
    if (frameNo % 20 === 0) frameFree()
  }
  const live = () => ({
    throttle: anim.throttle, alt: anim.alt, pumpSpeed: anim.pspeed, temp: anim.ftemp, fusionOn: anim.fon,
    line: {
      throughput: line.sim.throughput, wip: line.sim.wip(), bottleneck: line.bottleneck, settled: line.bottleneckGlow > 0.5,
      down: line.sim.stations.some((ms) => ms.some((m) => m.state === 'down')), starved: false,
    },
    car: { v: anim.cv, battery: load(anim.cv, anim.ca).battery, wheel: load(anim.cv, anim.ca).wheel, t100: anim.t100, launching: S.car.mode === 'launch' },
    motor: { rpm: anim.mrpm },
    robot: { power: anim.rpower, knee: anim.rknee, runtime: 2300 / Math.max(50, anim.rpower), depth: 0 },
    f1: { kmh: anim.f1v, open: anim.f1open },
    drone: { rpm: [0, 1, 2, 3].map((k) => dsim.rpm(k)), watts: dsim.watts(), tiltDeg: (Math.hypot(dsim.tilt.x, dsim.tilt.y) * 180) / Math.PI, wind: anim.dwind, mass: dsim.mass, thrust: dsim.thrust.reduce((a, b) => a + b, 0) },
    jet: { thrust: (JET.dry * Math.pow(anim.jthr, 1.6)) + (JET.wet - JET.dry) * anim.jab, fuel: JET.fuelDry * Math.pow(anim.jthr, 1.8) + (JET.fuelWet - JET.fuelDry) * anim.jab, tit: 450 + (JET.tit - 450) * Math.pow(anim.jthr, 1.2), ab: anim.jab },
    hole: { stage: anim.hstage, probeR: anim.probeR, clock: anim.probeClock, redshift: 1 / Math.sqrt(Math.max(1e-6, 1 - 1 / anim.probeR)), stretch: anim.probeStretch },
  })

  /* ---------------- tour ---------------- */
  const resetEngine = () => {
    S.exhibit = 'engine'
    Object.assign(S.engine, { view: 'whole', follow: 'all', throttle: 1, alt: 0, running: true })
    changed()
  }
  const resetPump = () => {
    S.exhibit = 'pump'
    Object.assign(S.pump, { view: 'cut', follow: 'all', speed: 1, mode: 'run', strobe: false, modeT: 0 })
    changed()
  }
  const resetFusion = () => {
    S.exhibit = 'fusion'
    Object.assign(S.fusion, { view: 'whole', follow: 'all', temp: 150, mode: 'run', modeT: 0 })
    anim.fcut = 0
    anim.fexplode = 0
    anim.ftemp = 150
    changed()
  }
  const resetLine = () => {
    S.exhibit = 'line'
    Object.assign(S.line, { frameSpeed: 1, robots: 1, buffer: 2, breakdowns: false })
    line.sim.reset()
    line.resetHistory()
    lineApply()
    line.warm(40)
    changed()
  }
  const resetCar = () => {
    S.exhibit = 'car'
    Object.assign(S.car, { view: 'whole', follow: 'all', speed: 0, mode: 'cruise', modeT: 0, height: 'normal' })
    anim.cv = 0
    anim.cxray = 0
    anim.cexplode = 0
    changed()
  }
  const resetMotor = () => {
    S.exhibit = 'motor'
    Object.assign(S.motor, { view: 'whole', follow: 'all', rpm: 7000, mode: 'drive' })
    anim.mcut = 0
    anim.mexplode = 0
    changed()
  }
  const resetJet = () => {
    S.exhibit = 'jet'
    Object.assign(S.jet, { view: 'whole', follow: 'all', throttle: 1, ab: true })
    anim.jcut = 0
    anim.jexp = 0
    anim.jthr = 1
    anim.jab = 1
    changed()
  }
  const resetDrone = () => {
    S.exhibit = 'drone'
    Object.assign(S.drone, { view: 'whole', follow: 'all', mode: 'hover', payload: false })
    anim.dcut = 0
    anim.dexp = 0
    anim.dwind = 0
    dsim.p.set(0, DR.hoverY, 0)
    dsim.v.set(0, 0, 0)
    dsim.tilt.set(0, 0)
    dsim.rate.set(0, 0)
    dsim.integ.set(0, 0, 0)
    changed()
  }
  const resetF1 = () => {
    S.exhibit = 'f1'
    Object.assign(S.f1, { view: 'whole', follow: 'all', speed: 300, mode: 'corner' })
    anim.f1v = 300
    anim.f1open = 0
    anim.f1brake = 0
    anim.f1cut = 0
    anim.f1exp = 0
    changed()
  }
  const resetHole = () => {
    S.exhibit = 'hole'
    Object.assign(S.hole, { view: 'bh', mass: 0.64, mode: 'watch', modeT: 0 })
    anim.hopen = -0.4
    anim.hmix = 0
    changed()
  }
  const resetRobot = () => {
    S.exhibit = 'robot'
    Object.assign(S.robot, { view: 'whole', follow: 'all', mode: 'walk', payload: 0 })
    anim.rxray = 0
    anim.rexplode = 0
    changed()
  }
  const setEx = (ex: Exhibit) => () => ui.setExhibit(ex)
  startTour = (name: TourName, recording: boolean) => {
    const steps =
      name === 'main' ? mainTour(resetEngine)
      : name === 'pump' ? pumpTour(resetPump)
      : name === 'fusion' ? fusionTour(resetFusion, setEx)
      : name === 'line' ? lineTour(resetLine, setEx)
      : name === 'car' ? carTour(resetCar)
      : name === 'motor' ? motorTour(resetMotor)
      : name === 'robot' ? robotTour(resetRobot)
      : name === 'hole' ? holeTour(resetHole)
      : name === 'jet' ? jetTour(resetJet)
      : name === 'f1' ? f1Tour(resetF1)
      : name === 'drone' ? droneTour(resetDrone)
      : name === 'grand' ? grandTour(setEx, {
        start: () => { resetFusion(); resetEngine(); resetPump(); resetLine(); resetMotor(); resetCar(); resetRobot(); resetHole(); resetJet(); resetF1(); resetDrone(); S.exhibit = 'hall'; changed() },
        fusionBase: () => { resetFusion() }, fusion: () => { S.fusion.view = 'cut'; changed() },
        engineBase: () => { resetEngine() }, engine: () => { S.engine.view = 'cut'; S.engine.follow = 'fire'; changed() },
        pumpBase: () => { resetPump() }, pump: () => {},
        lineBase: () => { resetLine() }, line: () => {},
        motorBase: () => { resetMotor() }, motor: () => { S.motor.view = 'cut'; S.motor.follow = 'current'; changed() },
        carBase: () => { resetCar(); S.car.speed = 100; changed() }, car: () => { S.car.view = 'xray'; S.car.follow = 'energy'; changed() },
        robotBase: () => { resetRobot() }, robot: () => { S.robot.view = 'xray'; changed() },
        holeBase: () => { resetHole() }, hole: () => {},
        jetBase: () => { resetJet() }, jet: () => { S.jet.view = 'cut'; changed() },
        f1Base: () => { resetF1() }, f1: () => { S.f1.follow = 'air'; changed() },
        droneBase: () => { resetDrone() }, drone: () => { S.drone.follow = 'air'; changed() },
        droneGust: () => { S.drone.follow = 'all'; S.drone.mode = 'gust'; changed() },
      })
      : hallTour(setEx, { resetFusion: () => { resetFusion(); S.fusion.view = 'cut'; anim.fcut = 1; changed() }, resetEngine, resetLine })
    director.load(steps)
    director.start(simT)
    if (!recording) {
      const cancel = (e: Event) => {
        if ((e.target as HTMLElement)?.closest?.('#tour')) return
        director.stop()
        window.removeEventListener('pointerdown', cancel, true)
      }
      window.addEventListener('pointerdown', cancel, true)
      director.onEnd = () => window.removeEventListener('pointerdown', cancel, true)
    }
  }

  /* ---------------- first frames ---------------- */
  ui.progress(0.8, 'Compiling shaders')
  await nextFrame()
  changed()
  step(1 / 60)
  // compile both shader variants (whole and cut open) up front so the first click never stutters
  const compile = async () => { try { await renderer.compileAsync(scene, camera) } catch { /* lazy compile instead */ } }
  mark('pre-compile')
  for (const on of [true, false]) {
    raptor.cut.setCaps(on)
    pump.cut.setCaps(on)
    tok.cut.setCaps(on)
    du.cut.setCaps(on)
    for (const fm of [...raptor.fluids, ...pump.fluids]) fm.visible = true
    await compile()
  }
  mark('compiled')
  for (let i = 0; i < 90; i++) step(1 / 60)
  render()
  mark('first render')
  /* ---------------- reflection probes: steel reflects the room it stands in ---------------- */
  const probe = (at: THREE.Vector3, hide: THREE.Object3D[], mats: THREE.Material[], intensity: number) => {
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType })
    const cube = new THREE.CubeCamera(0.1, 80, rt)
    cube.layers.enableAll()
    cube.position.copy(at)
    const was = hide.map((o) => o.visible)
    hide.forEach((o) => (o.visible = false))
    scene.updateMatrixWorld(true)
    cube.update(renderer, scene)
    hide.forEach((o, i) => (o.visible = was[i]))
    const pm = new THREE.PMREMGenerator(renderer)
    const env = pm.fromCubemap(rt.texture).texture
    pm.dispose()
    rt.dispose()
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial
      sm.envMap = env
      sm.envMapIntensity = intensity
      sm.needsUpdate = true
    }
  }
  probe(new THREE.Vector3(CAR_POS.x, 1.3, CAR_POS.z), [truck.root], [truck.M.steel, truck.M.glass, truck.M.alu, truck.M.housing, truck.M.disc], 2.0)
  probe(new THREE.Vector3(DRONE_POS.x, 1.75, DRONE_POS.z + 0.6), [drone.root], [drone.M.glass, drone.M.alu, drone.M.bell, drone.M.carbon, drone.M.prop], 1.3)
  probe(new THREE.Vector3(F1_POS.x, 1.0, F1_POS.z + 0.2), [f1.root], [f1.M.paint, f1.M.carbon, f1.M.blue, f1.M.white, f1.M.visor, f1.M.mirror, f1.M.rim], 1.5)
  probe(new THREE.Vector3(FUSION_POS.x, TOKAMAK_MID, FUSION_POS.z), [tok.root, plant.group], [tok.M.vessel, tok.M.port, tok.M.cs, tok.M.gold], 1.3)
  for (let i = 0; i < 2; i++) step(1 / 60)
  render()
  ui.progress(1, 'Ready')
  await nextFrame()
  ui.ready()

  const lab = {
    THREE, scene, camera, controls, raptor, plume, pipeline, room, pump, tok, line, truck, du, S, anim, rig, changed, PUMP_POS, TK, ui, LINE_X, LINE_TOP, SHOTS,
    advance(seconds: number, fps = 60) {
      const n = Math.max(1, Math.round(seconds * fps))
      for (let i = 0; i < n; i++) step(1 / fps)
      render()
      return simT
    },
    cam(px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov?: number) {
      rig.set({ pos: [px, py, pz], target: [tx, ty, tz], fov: fov ?? camera.fov })
    },
  }
  ;(window as unknown as Record<string, unknown>).__lab = lab

  if (params.get('clean')) document.body.classList.add('clean')
  if (REC || params.get('fixed') === '1') {
    if (REC) document.body.classList.add('rec')
    ;(window as unknown as Record<string, unknown>).__rec = {
      start(name: TourName) {
        startTour(name, true)
        return director.duration
      },
      frame(dt: number, draw = true) {
        step(dt)
        if (draw) render()
        else {
          labels.update(W, H, lastDt)
          updateSpots()
          ui.frame(live())
        }
        return { t: simT, active: director.active }
      },
    }
    return
  }

  let last = performance.now()
  let slow = 0, fast = 0
  renderer.setAnimationLoop(() => {
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    step(dt)
    render()
    // adaptive resolution: trim quickly when frames run long, restore slowly
    if (dt > 0.021) { slow++; fast = 0 } else if (dt < 0.0175) { fast++; slow = Math.max(0, slow - 2) }
    if (slow > 20 && budget > 0.45e6) { budget *= 0.8; slow = 0; resize() }
    if (fast > 240 && budget < budgetMax) { budget = Math.min(budgetMax, budget * 1.15); fast = 0; resize() }
  })
}

let rig: CameraRig
let director: Director
let controlsRef: OrbitControls
let lineApply: () => void = () => {}
let startTour: (name: TourName, recording: boolean) => void = () => {}

boot().catch((e) => {
  console.error(e)
  ui.progress(0, 'Something went wrong while building the lab.')
})
