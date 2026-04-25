export class DrawPanel {
  constructor(el, onModeChange) {
    this.el = el
    this.onModeChange = onModeChange
    this._mode = null
    this._build()
  }

  _build() {
    this.el.innerHTML = `
      <div class="panel-title">Draw</div>
      <div class="mode-btns">
        <button class="mode-btn" data-mode="wall">Wall</button>
        <button class="mode-btn" data-mode="floor">Floor</button>
      </div>
      <p style="font-size:11px;color:#666;line-height:1.5">
        Select a mode, then click and drag on a wall or floor surface to define an area.
        After drawing, drag the extrude handle to add depth.
      </p>
    `

    this.el.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode
        if (this._mode === mode) {
          // Toggle off
          this._mode = null
          btn.classList.remove('active')
          this.onModeChange(null)
        } else {
          this._mode = mode
          this.el.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
          btn.classList.add('active')
          this.onModeChange(mode)
        }
      })
    })
  }

  deactivate() {
    this._mode = null
    this.el.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
  }
}
