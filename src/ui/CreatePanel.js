import { GRID_UNIT } from '../scene/Snapping.js'

const FT_TO_M = 0.3048

function feetToMeters(ft) {
  return ft * FT_TO_M
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
        <div class="dims-row" style="margin-bottom:8px">
          <div>
            <label>W (ft)</label>
            <input type="number" id="upload-w" value="2" min="0.1" step="0.5" />
          </div>
          <div>
            <label>D (ft)</label>
            <input type="number" id="upload-d" value="2" min="0.1" step="0.5" />
          </div>
          <div>
            <label>H (ft)</label>
            <input type="number" id="upload-h" value="3" min="0.1" step="0.5" />
          </div>
        </div>
        <input type="file" id="upload-file" accept=".glb,.obj" style="margin-bottom:8px;font-size:11px" />
        <button class="btn" id="upload-place">Place Model</button>
      </div>
    `

    this.el.querySelector('#prim-place').addEventListener('click', () => {
      const type = this.el.querySelector('#prim-type').value
      const w = feetToMeters(parseFloat(this.el.querySelector('#prim-w').value) || 2)
      const d = feetToMeters(parseFloat(this.el.querySelector('#prim-d').value) || 2)
      const h = feetToMeters(parseFloat(this.el.querySelector('#prim-h').value) || 3)
      this.onCreate({ kind: 'primitive', primType: type, w, d, h })
    })

    this.el.querySelector('#upload-place').addEventListener('click', () => {
      const file = this.el.querySelector('#upload-file').files[0]
      if (!file) return
      const w = feetToMeters(parseFloat(this.el.querySelector('#upload-w').value) || 2)
      const d = feetToMeters(parseFloat(this.el.querySelector('#upload-d').value) || 2)
      const h = feetToMeters(parseFloat(this.el.querySelector('#upload-h').value) || 3)
      this.onCreate({ kind: 'upload', file, w, d, h })
    })
  }
}
