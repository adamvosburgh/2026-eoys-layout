import { GRID_UNIT } from '../scene/Snapping.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as THREE from 'three'

const FT_TO_M = 0.3048

function feetToMeters(ft) {
  return ft * FT_TO_M
}

async function inferDimsFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const loader = new GLTFLoader()
    loader.load(url, gltf => {
      URL.revokeObjectURL(url)
      const box = new THREE.Box3().setFromObject(gltf.scene)
      const size = new THREE.Vector3()
      box.getSize(size)
      resolve({
        w: parseFloat((size.x / FT_TO_M).toFixed(2)),
        d: parseFloat((size.z / FT_TO_M).toFixed(2)),
        h: parseFloat((size.y / FT_TO_M).toFixed(2)),
      })
    }, undefined, err => {
      URL.revokeObjectURL(url)
      reject(err)
    })
  })
}

export class CreatePanel {
  constructor(el, onCreate) {
    this.el = el
    this.onCreate = onCreate
    this._build()
  }

  _build() {
    this.el.innerHTML = `
      <div class="panel-title">Create</div>

      <div class="create-segment">
        <label>Primitive</label>
        <select id="prim-type" style="margin-bottom:8px">
          <option value="box">Box</option>
          <option value="cylinder">Cylinder</option>
          <option value="sphere">Sphere</option>
        </select>
        <div class="dims-row">
          <div>
            <label>W (ft)</label>
            <input type="number" id="prim-w" value="2" min="0.1" step="0.5" />
          </div>
          <div>
            <label>D (ft)</label>
            <input type="number" id="prim-d" value="2" min="0.1" step="0.5" />
          </div>
          <div>
            <label>H (ft)</label>
            <input type="number" id="prim-h" value="3" min="0.1" step="0.5" />
          </div>
        </div>
        <button class="btn" id="prim-place">Place Primitive</button>
      </div>

      <div class="create-segment">
        <label>Upload Model (.glb / .obj)</label>
        <input type="file" id="upload-file" accept=".glb,.obj" style="margin-bottom:8px;font-size:11px" />
        <div class="toggle-row" style="margin-bottom:8px;display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="upload-infer" />
          <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em">Infer dimensions from file</span>
        </div>
        <div class="dims-row" style="margin-bottom:8px">
          <div>
            <label>W (ft)</label>
            <input type="number" id="upload-w" placeholder="—" min="0.1" step="0.5" />
          </div>
          <div>
            <label>D (ft)</label>
            <input type="number" id="upload-d" placeholder="—" min="0.1" step="0.5" />
          </div>
          <div>
            <label>H (ft)</label>
            <input type="number" id="upload-h" placeholder="—" min="0.1" step="0.5" />
          </div>
        </div>
        <button class="btn" id="upload-place" disabled>Place Model</button>
        <span id="upload-infer-status" style="font-size:11px;margin-left:8px;color:#666"></span>
      </div>
    `

    const fileInput   = this.el.querySelector('#upload-file')
    const inferCheck  = this.el.querySelector('#upload-infer')
    const wInput      = this.el.querySelector('#upload-w')
    const dInput      = this.el.querySelector('#upload-d')
    const hInput      = this.el.querySelector('#upload-h')
    const placeBtn    = this.el.querySelector('#upload-place')
    const inferStatus = this.el.querySelector('#upload-infer-status')

    const updatePlaceBtn = () => {
      const hasFile = !!fileInput.files[0]
      const hasW = parseFloat(wInput.value) > 0
      const hasD = parseFloat(dInput.value) > 0
      const hasH = parseFloat(hInput.value) > 0
      placeBtn.disabled = !(hasFile && hasW && hasD && hasH)
    }

    const runInfer = async () => {
      const file = fileInput.files[0]
      if (!file || !file.name.toLowerCase().endsWith('.glb')) {
        inferStatus.textContent = file ? 'Only .glb supported for infer' : ''
        return
      }
      inferStatus.textContent = 'Reading…'
      try {
        const dims = await inferDimsFromFile(file)
        wInput.value = dims.w
        dInput.value = dims.d
        hInput.value = dims.h
        inferStatus.textContent = ''
        updatePlaceBtn()
      } catch {
        inferStatus.textContent = 'Could not read file'
      }
    }

    fileInput.addEventListener('change', () => {
      if (inferCheck.checked) runInfer()
      else updatePlaceBtn()
    })

    inferCheck.addEventListener('change', () => {
      if (inferCheck.checked && fileInput.files[0]) runInfer()
    })

    wInput.addEventListener('input', updatePlaceBtn)
    dInput.addEventListener('input', updatePlaceBtn)
    hInput.addEventListener('input', updatePlaceBtn)

    this.el.querySelector('#prim-place').addEventListener('click', () => {
      const type = this.el.querySelector('#prim-type').value
      const w = feetToMeters(parseFloat(this.el.querySelector('#prim-w').value) || 2)
      const d = feetToMeters(parseFloat(this.el.querySelector('#prim-d').value) || 2)
      const h = feetToMeters(parseFloat(this.el.querySelector('#prim-h').value) || 3)
      this.onCreate({ kind: 'primitive', primType: type, w, d, h })
    })

    placeBtn.addEventListener('click', () => {
      const file = fileInput.files[0]
      if (!file) return
      const w = feetToMeters(parseFloat(wInput.value))
      const d = feetToMeters(parseFloat(dInput.value))
      const h = feetToMeters(parseFloat(hInput.value))
      if (!w || !d || !h) return
      this.onCreate({ kind: 'upload', file, w, d, h })
    })
  }
}
