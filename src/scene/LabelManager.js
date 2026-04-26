import * as THREE from 'three'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

export class LabelManager {
  constructor(container, camera, scene) {
    this.camera = camera
    this.scene = scene
    this._labels = new Map() // id → { object3d, css2d }

    this._renderer = new CSS2DRenderer()
    this._renderer.setSize(container.clientWidth, container.clientHeight)
    this._renderer.domElement.style.position = 'absolute'
    this._renderer.domElement.style.top = '0'
    this._renderer.domElement.style.left = '0'
    this._renderer.domElement.style.pointerEvents = 'none'
    container.appendChild(this._renderer.domElement)

    this.visible = true

    window.addEventListener('resize', () => {
      this._renderer.setSize(container.clientWidth, container.clientHeight)
    })
  }

  add(id, position, name, description = '', onDelete = null) {
    if (this._labels.has(id)) this.remove(id)

    const div = document.createElement('div')
    div.style.cssText = `
      position: relative;
      font-family: 'Roboto Mono', monospace;
      font-size: 11px;
      background: #fff;
      border: 1px solid #000;
      padding: 2px 6px;
      pointer-events: none;
      white-space: nowrap;
    `

    const text = document.createElement('span')
    text.textContent = name
    div.appendChild(text)

    const xBtn = document.createElement('span')
    xBtn.textContent = '×'
    xBtn.title = 'Delete'
    xBtn.style.cssText = `
      position: absolute;
      top: -8px;
      right: -8px;
      width: 14px;
      height: 14px;
      background: #fff;
      border: 1px solid #000;
      font-size: 11px;
      line-height: 12px;
      text-align: center;
      pointer-events: auto;
      cursor: pointer;
      user-select: none;
    `
    xBtn.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault() })
    xBtn.addEventListener('click', e => {
      e.stopPropagation()
      e.preventDefault()
      onDelete?.(id)
    })
    div.appendChild(xBtn)

    div.title = description

    const label = new CSS2DObject(div)
    label.position.set(...position)
    label.layers.set(1)
    this.scene.add(label)

    this._labels.set(id, { label, div, text })
    label.visible = this.visible
  }

  update(id, position, name, description = '') {
    if (!this._labels.has(id)) return
    const { label, div, text } = this._labels.get(id)
    label.position.set(...position)
    text.textContent = name
    div.title = description
  }

  remove(id) {
    if (!this._labels.has(id)) return
    const { label } = this._labels.get(id)
    this.scene.remove(label)
    this._labels.delete(id)
  }

  setVisible(v) {
    this.visible = v
    for (const { label } of this._labels.values()) {
      label.visible = v
    }
  }

  render() {
    this._renderer.render(this.scene, this.camera)
  }
}
