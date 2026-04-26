export class Sidebar {
  constructor(iconsEl, panelsEl) {
    this.iconsEl = iconsEl
    this.panelsEl = panelsEl
    this._panels = []
    this._active = null
  }

  addPanel(id, label, el, onClose) {
    el.classList.add('sidebar-panel')
    el.id = `panel-${id}`
    this.panelsEl.appendChild(el)

    const btn = document.createElement('button')
    btn.className = 'sidebar-icon-btn'
    btn.textContent = label
    btn.dataset.panel = id
    btn.addEventListener('click', () => this.toggle(id))
    this.iconsEl.appendChild(btn)

    this._panels.push({ id, el, btn, onClose })
  }

  toggle(id) {
    if (this._active === id) {
      this._close()
    } else {
      this._open(id)
    }
  }

  _open(id) {
    this._close()
    const panel = this._panels.find(p => p.id === id)
    if (!panel) return
    panel.el.classList.add('visible')
    panel.btn.classList.add('active')
    this._active = id
  }

  _close() {
    for (const p of this._panels) {
      if (p.el.classList.contains('visible')) p.onClose?.()
      p.el.classList.remove('visible')
      p.btn.classList.remove('active')
    }
    this._active = null
  }
}
