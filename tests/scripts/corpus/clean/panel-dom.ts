export function render(root: HTMLElement, rows: string[]): void {
  const list = document.createElement('ul')
  for (const row of rows) {
    const item = document.createElement('li')
    item.textContent = row
    item.setAttribute('data-row', row)
    list.append(item)
  }
  root.replaceChildren(list)
  if (typeof window !== 'undefined') window.addEventListener('resize', () => render(root, rows))
}
