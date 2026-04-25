import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001'

let doc = null
let provider = null
let objectsMap = null
let visibilityMap = null

export function getDoc() { return doc }
export function getObjects() { return objectsMap }
export function getVisibility() { return visibilityMap }
export function getAwareness() { return provider?.awareness }

export function connect(roomSlug) {
  disconnect()

  doc = new Y.Doc()
  objectsMap = doc.getMap('objects')
  visibilityMap = doc.getMap('visibility')

  // Default visibility state
  doc.transact(() => {
    if (!visibilityMap.has('grid')) visibilityMap.set('grid', true)
    if (!visibilityMap.has('labels')) visibilityMap.set('labels', true)
    if (!visibilityMap.has('objects')) visibilityMap.set('objects', true)
  })

  provider = new WebsocketProvider(WS_URL, roomSlug, doc)

  // Set a random awareness state for this client
  const colors = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#c77dff']
  const clientColor = colors[Math.floor(Math.random() * colors.length)]
  provider.awareness.setLocalStateField('user', {
    name: `User-${Math.floor(Math.random() * 9000) + 1000}`,
    color: clientColor,
    cursor: null,
  })

  return { doc, provider, objectsMap, visibilityMap }
}

export function disconnect() {
  if (provider) {
    provider.destroy()
    provider = null
  }
  if (doc) {
    doc.destroy()
    doc = null
  }
  objectsMap = null
  visibilityMap = null
}

export function upsertObject(id, fields) {
  if (!objectsMap) return
  doc.transact(() => {
    let entry = objectsMap.get(id)
    if (!entry) {
      entry = new Y.Map()
      objectsMap.set(id, entry)
    }
    for (const [k, v] of Object.entries(fields)) {
      entry.set(k, v)
    }
  })
}

export function removeObject(id) {
  if (!objectsMap) return
  doc.transact(() => {
    objectsMap.delete(id)
  })
}

export function setVisibility(key, value) {
  if (!visibilityMap) return
  doc.transact(() => {
    visibilityMap.set(key, value)
  })
}
