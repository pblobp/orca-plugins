export type ElementOptions = {
  className?: string
  text?: string
  attrs?: Record<string, string>
}

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

export function icon(
  shapes: { tag: 'path' | 'rect'; attrs: Record<string, string> }[]
): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', 'vt-icon')
  for (const shape of shapes) {
    const node = document.createElementNS(SVG_NS, shape.tag)
    setAttributes(node, shape.attrs)
    svg.append(node)
  }
  return svg
}

export const PAUSE_ICON = [
  { tag: 'rect' as const, attrs: { x: '3', y: '2', width: '4', height: '12', rx: '1' } },
  { tag: 'rect' as const, attrs: { x: '9', y: '2', width: '4', height: '12', rx: '1' } }
]

export const PLAY_ICON = [{ tag: 'path' as const, attrs: { d: 'M4 2.5v11l9-5.5z' } }]
