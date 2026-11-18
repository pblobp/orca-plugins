export type ElementOptions = {
  className?: string
  text?: string
  attrs?: Record<string, string>
}

export type Shape = { tag: 'path' | 'rect' | 'circle'; attrs: Record<string, string> }

const SVG_NS = 'http://www.w3.org/2000/svg'
const EVENT_ATTRIBUTE = /^on/i

function setAttributes(node: Element, attrs: Record<string, string> | undefined): void {
  if (!attrs) return
  for (const [name, value] of Object.entries(attrs)) {
    if (EVENT_ATTRIBUTE.test(name)) continue
    node.setAttribute(name, value)
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: Node[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (options.className) node.className = options.className
  if (options.text !== undefined) node.textContent = options.text
  setAttributes(node, options.attrs)
  for (const child of children) node.append(child)
  return node
}

export function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text
}

export function setAttr(node: Element, name: string, value: string): void {
  if (EVENT_ATTRIBUTE.test(name)) return
  if (node.getAttribute(name) !== value) node.setAttribute(name, value)
}

export function toggleAttr(node: Element, name: string, on: boolean, value = ''): void {
  if (on) setAttr(node, name, value)
  else if (node.hasAttribute(name)) node.removeAttribute(name)
}

export function icon(shapes: readonly Shape[], className = 'vt-icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', className)
  for (const shape of shapes) {
    const node = document.createElementNS(SVG_NS, shape.tag)
    setAttributes(node, shape.attrs)
    svg.append(node)
  }
  return svg
}

export const PAUSE_ICON: readonly Shape[] = [
  { tag: 'rect', attrs: { x: '3', y: '2', width: '4', height: '12', rx: '1' } },
  { tag: 'rect', attrs: { x: '9', y: '2', width: '4', height: '12', rx: '1' } }
]

export const PLAY_ICON: readonly Shape[] = [{ tag: 'path', attrs: { d: 'M4 2.5v11l9-5.5z' } }]

export const SEARCH_ICON: readonly Shape[] = [
  { tag: 'circle', attrs: { cx: '7', cy: '7', r: '4.5' } },
  { tag: 'path', attrs: { d: 'M10.5 10.5L14 14' } }
]

export const CLOSE_ICON: readonly Shape[] = [{ tag: 'path', attrs: { d: 'M4 4l8 8M12 4l-8 8' } }]

export const CHEVRON_RIGHT: readonly Shape[] = [{ tag: 'path', attrs: { d: 'M6 3l5 5-5 5' } }]

export const CHEVRON_LEFT: readonly Shape[] = [{ tag: 'path', attrs: { d: 'M10 3L5 8l5 5' } }]

export const CHEVRON_DOWN: readonly Shape[] = [{ tag: 'path', attrs: { d: 'M3 6l5 5 5-5' } }]

export const CHEVRON_UP: readonly Shape[] = [{ tag: 'path', attrs: { d: 'M3 10l5-5 5 5' } }]

export const CHECK_ICON: readonly Shape[] = [{ tag: 'path', attrs: { d: 'M3 8.5l3.2 3L13 4.5' } }]

export const WARNING_ICON: readonly Shape[] = [
  { tag: 'path', attrs: { d: 'M8 2.2L14.5 13.5H1.5L8 2.2z' } },
  { tag: 'path', attrs: { d: 'M8 6.5v3.2' } },
  { tag: 'path', attrs: { d: 'M8 11.6v.1' } }
]
