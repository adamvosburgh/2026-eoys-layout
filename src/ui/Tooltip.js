export class Tooltip {
  constructor() {
    this._el = document.createElement('div')
    this._el.className = 'tooltip'
    this._el.style.display = 'none'
    document.body.appendChild(this._el)
  }

  show(text, x, y) {
    this._el.textContent = text
    this._el.style.display = 'block'
    this._el.style.left = `${x + 12}px`
    this._el.style.top = `${y + 12}px`
  }

  hide() {
    this._el.style.display = 'none'
  }
}
