# Changelog

All notable changes to OS Vitals are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A panel in the right sidebar with two views, Overview and Processes. The Overview's CPU card
  shows total, user and system usage over time, the load on each core, the load average and the
  uptime. The Processes view is a placeholder for now.
- A status bar item with the current CPU usage, updated at most every 5 seconds and only when the
  number changes. Pressing it opens the panel.
- Settings for the refresh interval, the history length, the status bar item, background sampling,
  the memory and CPU alerts, and the view the panel opens on.

### Access

- Runs a worker (`trusted-worker`) that reads CPU times, the load average, the uptime and the total
  memory from Node's `os` module.
- `settings:own`: reads its own settings.
- `notifications:show`: shows the current numbers when the panel cannot be opened from the status
  bar, and the memory alert.
- Contributes the OS Vitals panel, the OS Vitals status bar item and the `OS Vitals: Open panel`
  command (`os-vitals.open`).
- Runs Orca's own command-line tool (`orca plugin list`, `orca plugin open`) to open its panel when
  the status bar item is pressed. It finds the tool inside Orca's application folder.
