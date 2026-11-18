import type { InterfaceKind } from './protocol.ts'

export type InterfaceClass = { kind: InterfaceKind; counted: boolean }

export type Classifier = (name: string) => InterfaceClass

const MAC_KINDS: readonly [string, InterfaceKind][] = [
  ['lo', 'loopback'],
  ['utun', 'tunnel'],
  ['gif', 'tunnel'],
  ['stf', 'tunnel'],
  ['ipsec', 'tunnel'],
  ['ppp', 'tunnel'],
  ['bridge', 'bridge'],
  ['awdl', 'wireless-helper'],
  ['llw', 'wireless-helper'],
  ['anpi', 'wireless-helper'],
  ['ap', 'wireless-helper']
]

const MAC_UNCOUNTED = new Set(['lo', 'bridge', 'utun', 'gif', 'stf', 'awdl', 'llw', 'anpi', 'ap'])

const LINUX_KINDS: readonly [string, InterfaceKind][] = [
  ['lo', 'loopback'],
  ['docker', 'bridge'],
  ['bridge', 'bridge'],
  ['br', 'bridge'],
  ['virbr', 'bridge'],
  ['veth', 'virtual'],
  ['tun', 'tunnel'],
  ['tap', 'tunnel'],
  ['wg', 'tunnel'],
  ['gretap', 'tunnel'],
  ['gre', 'tunnel'],
  ['erspan', 'tunnel'],
  ['ip_vti', 'tunnel'],
  ['ip6_vti', 'tunnel'],
  ['ip6tnl', 'tunnel'],
  ['ip6gre', 'tunnel'],
  ['sit', 'tunnel']
]

function family(name: string): string {
  return name.replace(/\d+$/, '')
}

export function macInterface(name: string): InterfaceClass {
  const base = family(name)
  const kind = MAC_KINDS.find(([prefix]) => base === prefix)?.[1] ?? null
  return { kind, counted: !MAC_UNCOUNTED.has(base) }
}

export function linuxInterface(name: string): InterfaceClass {
  const kind = LINUX_KINDS.find(([prefix]) => name.startsWith(prefix))?.[1] ?? null
  return { kind, counted: kind === null }
}

export function classifierFor(platform: string): Classifier {
  return platform === 'linux' ? linuxInterface : macInterface
}
