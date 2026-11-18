import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const panel = (path: string) =>
  readFileSync(new URL(`../../plugins/os-vitals/panel/${path}`, import.meta.url), 'utf8')

function rowClasses(source: string): string[] {
  const found = new Set<string>()
  for (const match of source.matchAll(/el\('tr', \{ className: '([^']+)'/g)) {
    for (const name of match[1].split(/\s+/)) found.add(name)
  }
  return [...found]
}

function blocks(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: match[1].trim(), body: match[2] })
  }
  return out
}

test('no stylesheet rule turns a table row class into a flex or block box', () => {
  const css = panel('style.css')
  const classes = ['views/processes.ts', 'cards/top.ts', 'details/frame.ts'].flatMap((path) =>
    rowClasses(panel(path))
  )
  assert.ok(classes.includes('vt-row'))
  for (const name of classes) {
    for (const block of blocks(css)) {
      const targets = block.selector
        .split(',')
        .map((part) => part.trim())
        .some(
          (part) =>
            new RegExp(`\\.${name}(?![\\w-])`).test(part) &&
            !/\s/.test(part.split(`.${name}`)[1] ?? '')
        )
      if (targets)
        assert.doesNotMatch(block.body, /\bdisplay\s*:/, `${block.selector} sets display`)
    }
  }
})
