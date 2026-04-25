import { setVisibility, getVisibility } from '../collab/sync.js'

export class VisibilityToggles {
  constructor(container, callbacks) {
    this.container = container
    this.callbacks = callbacks // { grid, labels, objects }
    this._build()
  }

  _build() {
    const keys = ['grid', 'labels', 'objects']
    this.container.innerHTML = ''
    for (const key of keys) {
      const btn = document.createElement('button')
      btn.className = 'vis-btn active'
      btn.textContent = key
      btn.dataset.key = key
      btn.addEventListener('click', () => this._toggle(key, btn))
      this.container.appendChild(btn)
    }
  }

  _toggle(key, btn) {
    const vis = getVisibility()
    if (!vis) return
    const current = vis.get(key) !== false
    const next = !current
    setVisibility(key, next)
    btn.classList.toggle('active', next)
    if (this.callbacks[key]) this.callbacks[key](next)
  }

  sync(key, value) {
    const btn = this.container.querySelector(`[data-key="${key}"]`)
    if (!btn) return
    btn.classList.toggle('active', value)
    if (this.callbacks[key]) this.callbacks[key](value)
  }
}
