// Grid rendering deferred until base rendering is stable.
export class Grid {
  constructor() { this.visible = true }
  build() {}
  setVisible(v) { this.visible = v }
}
