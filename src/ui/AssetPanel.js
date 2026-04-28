import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// Shared thumbnail renderer — created once, reused for all assets
let _renderer = null
let _loader   = null

function thumbRenderer() {
  if (_renderer) return _renderer
  _renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  _renderer.setSize(120, 120)
  _renderer.setPixelRatio(1)
  _renderer.toneMapping = THREE.NeutralToneMapping
  _renderer.toneMappingExposure = 1.0
  return _renderer
}

function thumbLoader() {
  if (!_loader) _loader = new GLTFLoader()
  return _loader
}

function renderThumbnail(assetId) {
  return new Promise(resolve => {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf6f6f6)

    const ambient = new THREE.AmbientLight(0xffffff, 2.0)
    const dir = new THREE.DirectionalLight(0xffffff, 2.5)
    dir.position.set(2, 4, 3)
    scene.add(ambient, dir)

    const camera = new THREE.PerspectiveCamera(38, 1, 0.001, 500)

    thumbLoader().load(`/api/asset-file/${assetId}`, gltf => {
      const obj = gltf.scene
      const box = new THREE.Box3().setFromObject(obj)
      const center = new THREE.Vector3()
      const size   = new THREE.Vector3()
      box.getCenter(center)
      box.getSize(size)
      obj.position.sub(center)
      scene.add(obj)

      const maxDim = Math.max(size.x, size.y, size.z) || 1
      const dist = maxDim * 2.4
      camera.position.set(dist * 0.7, dist * 0.45, dist)
      camera.lookAt(0, 0, 0)

      const r = thumbRenderer()
      r.render(scene, camera)
      const dataUrl = r.domElement.toDataURL()

      obj.traverse(c => {
        if (c.isMesh) {
          c.geometry?.dispose()
          ;(Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m?.dispose())
        }
      })

      resolve(dataUrl)
    }, undefined, () => resolve(null))
  })
}

export class AssetPanel {
  constructor(el, onPlace) {
    this.el = el
    this.onPlace = onPlace
  }

  async refresh() {
    const res = await fetch('/api/assets')
    const assets = await res.json()
    this.render(assets)
  }

  render(assets) {
    this.el.innerHTML = `<div class="panel-title">Library</div>`
    if (!assets.length) {
      this.el.innerHTML += `<p style="font-size:11px;color:#888;margin-top:8px;">No approved assets yet.</p>`
      return
    }

    const grid = document.createElement('div')
    grid.className = 'asset-grid'
    this.el.appendChild(grid)

    for (const asset of assets) {
      const card = document.createElement('div')
      card.className = `asset-card${asset.category === 'projector' ? ' projector-asset' : ''}`
      card.draggable = true

      const thumb = document.createElement('div')
      thumb.className = 'asset-thumb'

      const placeholder = document.createElement('div')
      placeholder.className = 'asset-thumb-placeholder'
      placeholder.textContent = (asset.category || asset.name || '?')[0].toUpperCase()
      thumb.appendChild(placeholder)

      const img = document.createElement('img')
      img.className = 'asset-thumb-img'
      thumb.appendChild(img)

      const nameEl = document.createElement('div')
      nameEl.className = 'asset-card-name'
      nameEl.textContent = asset.name

      card.appendChild(thumb)
      card.appendChild(nameEl)
      grid.appendChild(card)

      card.addEventListener('click', () => this.onPlace(asset))
      card.addEventListener('dragstart', e => {
        e.dataTransfer.setData('application/json', JSON.stringify(asset))
        e.dataTransfer.effectAllowed = 'copy'
      })

      if (asset.file_path) {
        renderThumbnail(asset.id).then(dataUrl => {
          if (!dataUrl) return
          img.src = dataUrl
          img.classList.add('loaded')
          placeholder.style.display = 'none'
        })
      }
    }
  }
}
