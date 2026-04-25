export class AssetPanel {
  constructor(el, onPlace) {
    this.el = el
    this.onPlace = onPlace
  }

  async refresh() {
    const res = await fetch('/api/assets')
    const assets = await res.json()
    this.render(assets)
  }

  render(assets) {
    this.el.innerHTML = `<div class="panel-title">Assets</div>`
    if (!assets.length) {
      this.el.innerHTML += `<p style="font-size:11px;color:#666;">No approved assets yet.</p>`
      return
    }
    for (const asset of assets) {
      const item = document.createElement('div')
      item.className = `asset-item${asset.category === 'projector' ? ' projector-asset' : ''}`
      item.innerHTML = `
        <div>
          <div class="asset-name">${asset.name}</div>
          <div class="asset-category">${asset.category || ''}</div>
        </div>
      `
      item.addEventListener('click', () => this.onPlace(asset))
      this.el.appendChild(item)
    }
  }
}
