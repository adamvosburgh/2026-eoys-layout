export class CommentPanel {
  constructor(el, onStartPlace) {
    this.el = el
    this.onStartPlace = onStartPlace
    this._build()
  }

  _build() {
    this.el.innerHTML = `<div class="panel-title">Comment</div>`

    const creatorLabel = document.createElement('label')
    creatorLabel.textContent = 'Your name'
    this.el.appendChild(creatorLabel)

    this._creatorInput = document.createElement('input')
    this._creatorInput.type = 'text'
    this._creatorInput.placeholder = 'Name...'
    this._creatorInput.maxLength = 40
    this._creatorInput.value = localStorage.getItem('eoys_creator') || ''
    this.el.appendChild(this._creatorInput)

    const noteLabel = document.createElement('label')
    noteLabel.textContent = 'Note'
    this.el.appendChild(noteLabel)

    this._noteInput = document.createElement('textarea')
    this._noteInput.placeholder = 'Write a note...'
    this._noteInput.rows = 4
    this._noteInput.style.resize = 'vertical'
    this.el.appendChild(this._noteInput)

    this._placeBtn = document.createElement('button')
    this._placeBtn.className = 'btn primary'
    this._placeBtn.textContent = 'Place in scene'
    this._placeBtn.disabled = true
    this._placeBtn.style.marginTop = '4px'
    this.el.appendChild(this._placeBtn)

    this._hint = document.createElement('p')
    this._hint.style.cssText = 'font-size:10px;color:#888;margin-top:10px;display:none;'
    this._hint.textContent = 'Click anywhere in the scene to place the comment.'
    this.el.appendChild(this._hint)

    const update = () => {
      this._placeBtn.disabled = !this._creatorInput.value.trim() || !this._noteInput.value.trim()
    }
    this._creatorInput.addEventListener('input', update)
    this._noteInput.addEventListener('input', update)
    update()

    this._placeBtn.addEventListener('click', () => {
      const creator = this._creatorInput.value.trim()
      const note    = this._noteInput.value.trim()
      if (!creator || !note) return
      localStorage.setItem('eoys_creator', creator)
      this._hint.style.display = 'block'
      this._placeBtn.disabled = true
      this.onStartPlace({ creator, description: note })
    })
  }

  reset() {
    this._noteInput.value = ''
    this._hint.style.display = 'none'
    const creator = this._creatorInput.value.trim()
    this._placeBtn.disabled = !creator || !this._noteInput.value.trim()
  }
}
