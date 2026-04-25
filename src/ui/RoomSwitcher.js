export class RoomSwitcher {
  constructor(container, onSwitch) {
    this.container = container
    this.onSwitch = onSwitch
    this._active = null
  }

  render(rooms) {
    this.container.innerHTML = ''
    for (const room of rooms) {
      const btn = document.createElement('button')
      btn.className = 'room-tab'
      btn.textContent = room.roomName
      btn.dataset.slug = room.slug
      if (!this._active) {
        this._active = room.slug
        btn.classList.add('active')
      }
      btn.addEventListener('click', () => this._select(room.slug))
      this.container.appendChild(btn)
    }
  }

  _select(slug) {
    if (this._active === slug) return
    this._active = slug
    this.container.querySelectorAll('.room-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.slug === slug)
    })
    this.onSwitch(slug)
  }
}
