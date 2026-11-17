export type ProtectedGroup = 'system' | 'orca'

export type ProtectedMatch = 'path-prefix' | 'path-contains' | 'name' | 'name-prefix'

export type ProtectedRule = {
  match: ProtectedMatch
  value: string
  group: ProtectedGroup
  why: string
}

export const PROTECTED_RULES: readonly ProtectedRule[] = [
  { match: 'path-prefix', value: '/System/', group: 'system', why: 'part of macOS' },
  { match: 'path-prefix', value: '/usr/libexec/', group: 'system', why: 'a system service' },
  { match: 'path-prefix', value: '/usr/sbin/', group: 'system', why: 'a system service' },
  { match: 'path-prefix', value: '/sbin/', group: 'system', why: 'a system service' },
  { match: 'name', value: 'loginwindow', group: 'system', why: 'ends the login session' },
  { match: 'name', value: 'WindowServer', group: 'system', why: 'draws every window' },
  { match: 'name', value: 'Dock', group: 'system', why: 'the Dock' },
  { match: 'name', value: 'Finder', group: 'system', why: 'the Finder' },
  { match: 'name', value: 'WindowManager', group: 'system', why: 'manages windows' },
  { match: 'name', value: 'launchd', group: 'system', why: 'starts every other process' },
  {
    match: 'path-contains',
    value: '/orca/daemon-host/',
    group: 'orca',
    why: 'runs every Orca terminal and agent'
  },
  { match: 'name-prefix', value: 'Orca', group: 'orca', why: 'part of Orca' },
  { match: 'name', value: 'systemd', group: 'system', why: 'starts every other process' },
  { match: 'name', value: 'gnome-shell', group: 'system', why: 'the GNOME desktop' },
  { match: 'name', value: 'Xorg', group: 'system', why: 'the display server' },
  { match: 'name', value: 'Xwayland', group: 'system', why: 'the display server' },
  { match: 'name-prefix', value: 'kwin_', group: 'system', why: 'the KDE window manager' },
  { match: 'name', value: 'plasmashell', group: 'system', why: 'the KDE desktop' },
  { match: 'name-prefix', value: 'gdm', group: 'system', why: 'the GNOME login manager' },
  { match: 'name', value: 'sddm', group: 'system', why: 'the KDE login manager' },
  { match: 'name', value: 'dbus-daemon', group: 'system', why: 'the session message bus' },
  { match: 'name', value: 'dbus-broker', group: 'system', why: 'the session message bus' },
  { match: 'name', value: 'pipewire', group: 'system', why: 'the sound and video server' },
  { match: 'name', value: 'wireplumber', group: 'system', why: 'the sound and video server' },
  { match: 'name', value: 'sshd', group: 'system', why: 'remote logins' },
  { match: 'name', value: 'login', group: 'system', why: 'the login session' }
]

export function protectedRule(
  target: { name: string; path: string },
  rules: readonly ProtectedRule[] = PROTECTED_RULES
): ProtectedRule | null {
  for (const rule of rules) {
    if (rule.match === 'path-prefix' && target.path.startsWith(rule.value)) return rule
    if (rule.match === 'path-contains' && target.path.includes(rule.value)) return rule
    if (rule.match === 'name' && target.name === rule.value) return rule
    if (rule.match === 'name-prefix' && target.name.startsWith(rule.value)) return rule
  }
  return null
}
