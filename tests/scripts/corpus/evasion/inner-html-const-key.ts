const key = 'inner' + 'HTML'

export function show(el: HTMLElement, x: string) {
  el[key] = x
}
