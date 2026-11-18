# Changelog

All notable changes to OS Vitals are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [1.0.0]

The first release.

### Added

- A panel in the right sidebar with two views, Overview and Processes, as a tab list you can move
  through with the arrow keys.
- The Overview: CPU (total, user and system over time, the load on each core with performance and
  efficiency cores on Apple silicon, the load average and the uptime), memory (split by kind, with
  pressure and swap), network, disk (rates and the startup disk's space), GPU, battery, and the five
  processes using the most CPU.
- Detail views for CPU, memory, network, disk, GPU and energy, opened from each card's title, with
  an Overview control and Escape to go back. Charts show the time and values under the pointer,
  take keyboard focus (arrow keys, Page Up and Down, Home and End), and label their one scale;
  network and disk scales rise above the highest reading in view.
- The Processes view: filter, sort and page every process, see the details of one, and quit it
  behind a confirmation, with Force quit after 5 seconds. The worker refuses PID 1, other users'
  processes, a reused PID, Orca itself, kernel threads and the protected set listed in the README.
- Energy impact per process and the apps that keep the computer awake, on macOS, read every 10
  seconds and only while the Energy view is open.
- Linux: memory with buffers, cache and pressure, processes and their details from `/proc`,
  quitting, network, disk I/O, disk space, NVIDIA and AMD GPU use, and the battery with its power
  draw.
- Windows and other systems: CPU and memory, and one note in the panel that says so.
- A status bar item with the current CPU and memory usage, updated at most every 5 seconds and only
  when a number changes. Pressing it opens the panel.
- A memory alert: when memory pressure is critical, or memory in use stays at or above the limit
  you set for 30 seconds, one desktop notification names the process using the most memory, then
  the alert stays silent for 10 minutes. The status bar item turns red while it lasts.
- A CPU alert, off by default: CPU at or above the limit you set for a minute turns the status bar
  item amber. It sends no notification.
- A pause control that stops the panel's readings and says when the last one was taken. The status
  bar item and the alerts keep running.
- Nine settings, each applied at once: the refresh interval, the history length, the status bar
  item, background sampling, the memory alert and its limit, the CPU alert and its limit, and the
  view the panel opens on.

### Access

- Execution level: `trusted-worker`. A Node process runs the plugin's worker as your user, with no
  administrator rights.
- Capabilities: `settings:own` (reads its own settings) and `notifications:show` (the memory alert,
  and the current numbers when the panel cannot be opened from the status bar item).
- Contributes the OS Vitals panel, the OS Vitals status bar item and the `OS Vitals: Open panel`
  command (`os-vitals.open`). No hooks, no events, no other contributions.
- Node modules: `node:child_process`, `node:fs`, `node:os`, `node:path`, `node:timers` and
  `node:url`. No network module and no network access.
- Programs on macOS: `/bin/ps`, `/usr/bin/vm_stat`, `/usr/sbin/sysctl`, `/usr/sbin/ioreg`,
  `/usr/sbin/netstat`, `/sbin/route`, `/bin/df`, `/usr/bin/pmset` and `/usr/bin/top`.
- Programs on Linux: `/usr/bin/nvidia-smi` or `/usr/local/bin/nvidia-smi`, only when one exists.
  Everything else on Linux is read from `/proc`, `/sys` and `/etc/passwd`.
- Orca's own command-line tool (`orca plugin list`, `orca plugin open`), found inside Orca's
  application folder, to open the panel when the status bar item is pressed.
- Signals: `SIGTERM`, or `SIGKILL` when you force it, only to a process you confirm in the panel,
  after the checks the README describes.
