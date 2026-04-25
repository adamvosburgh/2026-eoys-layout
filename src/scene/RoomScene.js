import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

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
    this.renderer.toneMappingExposure = 1
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
  }

  _initCamera() {
    const { width, height } = this._size()
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200)
    this.camera.position.set(8, 6, 8)
    this.camera.lookAt(0, 0, 0)
  }

  _initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 0.5
    this.controls.maxDistance = 100
  }

  _startLoop() {
    this.renderer.setAnimationLoop(() => {
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

  focusRoom(meta) {
    if (!meta) return
    const bbox   = meta.boundingBox
    const floorY = meta.floorY ?? bbox.min[1]
    const cx     = (bbox.min[0] + bbox.max[0]) / 2
    const cz     = (bbox.min[2] + bbox.max[2]) / 2
    const span   = Math.max(bbox.max[0] - bbox.min[0], bbox.max[2] - bbox.min[2])

    this.controls.target.set(cx, floorY, cz)
    this.camera.position.set(
      cx + span * 0.4,
      floorY + span * 0.9,
      cz + span * 0.65
    )
    this.camera.lookAt(cx, floorY, cz)
    this.controls.update()
  }

  onFrame(cb) { this._onFrame = cb }

  dispose() {
    this.renderer.setAnimationLoop(null)
    this.renderer.dispose()
  }
}
