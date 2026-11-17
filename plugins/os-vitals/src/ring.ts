export type Ring<T> = {
  push(item: T): void
  toArray(): T[]
  last(): T | undefined
  size(): number
  capacity(): number
  resize(capacity: number): void
  clear(): void
}

export function createRing<T>(initialCapacity: number): Ring<T> {
  let limit = Math.max(1, Math.floor(initialCapacity))
  let items: T[] = []
  let start = 0

  const ordered = (): T[] =>
    items.length < limit ? items.slice() : items.slice(start).concat(items.slice(0, start))

  return {
    push(item) {
      if (items.length < limit) {
        items.push(item)
        return
      }
      items[start] = item
      start = (start + 1) % limit
    },
    toArray: ordered,
    last() {
      if (items.length === 0) return undefined
      return items.length < limit ? items[items.length - 1] : items[(start + limit - 1) % limit]
    },
    size: () => items.length,
    capacity: () => limit,
    resize(capacity) {
      const next = Math.max(1, Math.floor(capacity))
      if (next === limit) return
      const kept = ordered().slice(-next)
      limit = next
      items = kept
      start = 0
    },
    clear() {
      items = []
      start = 0
    }
  }
}
