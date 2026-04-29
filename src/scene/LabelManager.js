import * as THREE from 'three'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

export class LabelManager {
  constructor(container, camera, scene) {
    this.camera = camera
    this.scene = scene
    this._labels = new Map() // id → { label, div, text, xBtn, lockBtn, rawName, locked, isComment }

    this._renderer = new CSS2DRenderer()
    this._renderer.setSize(container.clientWidth, container.clientHeight)
    this._renderer.domElement.style.position = 'absolute'
    this._renderer.domElement.style.top = '0'
    this._renderer.domElement.style.left = '0'
    this._renderer.domElement.style.pointerEvents = 'none'
    container.appendChild(this._renderer.domElement)

    this.visible = true
    this.commentsVisible = true

    window.addEventListener('resize', () => {
      this._renderer.setSize(container.clientWidth, container.clientHeight)
    })
  }

  // options: { background?: string, isComment?: boolean }
  add(id, position, name, description = '', onDelete = null, onLock = null, options = {}) {
    if (this._labels.has(id)) this.remove(id)

    const isComment = options.isComment || false
    const bg = options.background || '#fff'

    const div = document.createElement('div')
    div.style.cssText = `
      display: flex;
      align-items: center;
      font-family: 'Roboto Mono', monospace;
      font-size: 10px;
      background: ${bg};
      border: 1px solid #000;
      white-space: nowrap;
      pointer-events: none;
      overflow: hidden;
    `

    const btnStyle = `
      padding: 2px 5px;
      pointer-events: auto;
      cursor: pointer;
      user-select: none;
      font-size: 9px;
      line-height: 1.5;
      border-right: 1px solid rgba(0,0,0,0.15);
      flex-shrink: 0;
    `

    let xBtn = null
    if (onDelete) {
      xBtn = document.createElement('span')
      xBtn.textContent = 'X'
      xBtn.title = 'Delete'
      xBtn.style.cssText = btnStyle
      xBtn.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault() })
      xBtn.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); onDelete(id) })
      div.appendChild(xBtn)
    }

    let lockBtn = null
    if (onLock) {
      lockBtn = document.createElement('span')
      lockBtn.textContent = '🔓'
      lockBtn.title = 'Lock'
      lockBtn.style.cssText = btnStyle
      lockBtn.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault() })
      lockBtn.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); onLock(id) })
      div.appendChild(lockBtn)
    }

    const text = document.createElement('span')
    text.textContent = name
    text.style.cssText = 'padding: 2px 6px;'
    div.appendChild(text)

    div.title = description

    const label = new CSS2DObject(div)
    label.position.set(...position)
    label.layers.set(1)
    this.scene.add(label)

    const visible = isComment ? this.commentsVisible : this.visible
    label.visible = visible

    this._labels.set(id, { label, div, text, xBtn, lockBtn, rawName: name, locked: false, isComment })
  }

  update(id, position, name, description = '') {
    if (!this._labels.has(id)) return
    const entry = this._labels.get(id)
    entry.rawName = name
    entry.label.position.set(...position)
    entry.text.textContent = name
    entry.div.title = description
  }

  setLocked(id, isLocked) {
    if (!this._labels.has(id)) return
    const entry = this._labels.get(id)
    entry.locked = isLocked
    if (entry.lockBtn) {
      entry.lockBtn.textContent = isLocked ? '🔒' : '🔓'
      entry.lockBtn.title = isLocked ? 'Unlock' : 'Lock'
    }
    if (entry.xBtn) entry.xBtn.style.display = isLocked ? 'none' : ''
    entry.div.style.opacity = isLocked ? '0.6' : '1'
  }

  setLabelVisible(id, visible) {
    if (!this._labels.has(id)) return
    this._labels.get(id).label.visible = visible
  }

  setVisible(v) {
    this.visible = v
    for (const { label, isComment } of this._labels.values()) {
      if (!isComment) label.visible = v
    }
  }

  setCommentsVisible(v) {
    this.commentsVisible = v
    for (const { label, isComment } of this._labels.values()) {
      if (isComment) label.visible = v
    }
  }

  remove(id) {
    if (!this._labels.has(id)) return
    const { label } = this._labels.get(id)
    this.scene.remove(label)
    this._labels.delete(id)
  }

  render() {
    this._renderer.render(this.scene, this.camera)
  }
}
