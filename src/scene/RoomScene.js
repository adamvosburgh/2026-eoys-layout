import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

// Global camera starting frame (applied to every room load)
const DEFAULT_CAM_POS    = [-1.458, 0.407, 0.136]
const DEFAULT_CAM_TARGET = [-0.993, 0.337, 0.306]

export class RoomScene {
  constructor(container) {
    this.container = container
    this._initRenderer()
    this._initScene()
    this._initCamera()
    this._initControls()
    this._startLoop()
    window.addEventListener('resize', () => this._onResize())
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.container.appendChild(this.renderer.domElement)
    const { width, height } = this._size()
    this.renderer.setSize(width, height)
  }

  _initScene() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xffffff)

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    // Defaults tuned to give a flatter, ambient-dominant look out of the box.
    this.scene.environmentIntensity = 3.0

    // Directional "sun" — provides the sharp shadow term. IBL gives the soft fill.
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.0)
    this.dirLight.position.set(5, 12, 5)
    this.dirLight.castShadow = true
    this.dirLight.shadow.mapSize.set(2048, 2048)
    const c = this.dirLight.shadow.camera
    c.left = -12; c.right = 12; c.top = 12; c.bottom = -12
    c.near = 0.1; c.far = 60
    this.dirLight.shadow.bias = -0.0005
    this.dirLight.shadow.normalBias = 0.02
    this.dirLight.target.position.set(0, 1, 0)
    this.scene.add(this.dirLight)
    this.scene.add(this.dirLight.target)
  }

  _initCamera() {
    const { width, height } = this._size()
    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.05, 200)
    this.camera.layers.enable(1)
    this.camera.position.set(...DEFAULT_CAM_POS)
    this.camera.lookAt(...DEFAULT_CAM_TARGET)
  }

  _initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.minDistance = 0.1
    this.controls.maxDistance = 30
    // Tuned for small (room-scale, ~1m–10m) viewing
    this.controls.rotateSpeed = 0.7
    this.controls.panSpeed    = 0.8
    this.controls.zoomSpeed   = 0.9
    this.controls.zoomToCursor = true
    // Default mouse mapping (LEFT=ROTATE, RIGHT=PAN, MIDDLE=DOLLY) is what we want.
    // Mobile touch defaults: 1-finger=ROTATE, 2-finger=DOLLY+PAN.
    this.controls.target.set(...DEFAULT_CAM_TARGET)
    this.controls.update()
  }

  _initKeyboard() {
    this._keys = new Set()
    const onDown = e => {
      // Ignore when typing in an input
      const tag = (e.target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      this._keys.add(e.key.toLowerCase())
    }
    const onUp = e => this._keys.delete(e.key.toLowerCase())
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup',   onUp)
    window.addEventListener('blur',  () => this._keys.clear())
    this._lastFrameTime = performance.now()
  }

  _applyKeyboard() {
    if (!this._keys || !this._keys.size) {
      this._lastFrameTime = performance.now()
      return
    }
    const now = performance.now()
    const dt  = Math.min((now - this._lastFrameTime) / 1000, 0.1)
    this._lastFrameTime = now

    const k = this._keys
    const baseSpeed = k.has('shift') ? 4.0 : 1.5  // m/s
    const speed = baseSpeed * dt

    const fwd = new THREE.Vector3()
    this.camera.getWorldDirection(fwd)
    fwd.y = 0
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1)
    fwd.normalize()
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize()

    const delta = new THREE.Vector3()
    if (k.has('w') || k.has('arrowup'))    delta.add(fwd)
    if (k.has('s') || k.has('arrowdown'))  delta.sub(fwd)
    if (k.has('a') || k.has('arrowleft'))  delta.sub(right)
    if (k.has('d') || k.has('arrowright')) delta.add(right)
    if (k.has('q') || k.has(' '))          delta.y += 1
    if (k.has('e'))                        delta.y -= 1

    if (delta.lengthSq() === 0) return
    delta.normalize().multiplyScalar(speed)
    this.camera.position.add(delta)
    this.controls.target.add(delta)
  }

  _startLoop() {
    this._initKeyboard()
    this.renderer.setAnimationLoop(() => {
      this._applyKeyboard()
      this.controls.update()
      if (this._onFrame) this._onFrame()
      this.renderer.render(this.scene, this.camera)
    })
  }

  _size() {
    return {
      width:  this.container.clientWidth  || window.innerWidth,
      height: this.container.clientHeight || window.innerHeight,
    }
  }

  _onResize() {
    const { width, height } = this._size()
    this.renderer.setSize(width, height)
    if (this.camera) {
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
    }
  }

  focusRoom(_meta) {
    // Global starting frame — same for every room. Override per-room later if needed.
    this.camera.position.set(...DEFAULT_CAM_POS)
    this.controls.target.set(...DEFAULT_CAM_TARGET)
    this.camera.lookAt(...DEFAULT_CAM_TARGET)
    this.controls.update()
  }

  onFrame(cb) { this._onFrame = cb }

  dispose() {
    this.renderer.setAnimationLoop(null)
    this.renderer.dispose()
  }
}
