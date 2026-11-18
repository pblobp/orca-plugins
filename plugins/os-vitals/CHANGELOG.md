# Changelog

All notable changes to OS Vitals are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A panel in the right sidebar with two views, Overview and Processes. The Overview's CPU card
  shows total, user and system usage over time, the load on each core, the load average and the
  uptime.
- Performance and efficiency cores on Apple silicon, shown as two labeled groups.
- A memory card on macOS: memory in use out of the total, split into app memory, wired, compressed
  and cached files, with memory pressure and swap. Windows shows used and free memory.
- The five processes using the most CPU on the Overview, and on macOS a Processes view that
  filters, sorts and pages every process, with a details pane for the selected one.
- Quitting a process on macOS from the details pane, behind a confirmation, with Force quit after
  5 seconds. The worker refuses PID 1, other users' processes, a reused PID, Orca itself and the
  protected set listed in the README.
- Network, Disk, GPU and Battery cards on the Overview on macOS, and a detail view for CPU, memory,
  network, disk, GPU and energy, opened from each card's title. Charts show the time and values
  under the pointer, take keyboard focus, and label their scale; network and disk scales rise
  above the highest reading in view.
- Energy impact per process and the apps that keep the computer awake, read every 10 seconds and
  only while the Energy view is open.
- Linux: memory with buffers, cache and pressure, processes and their details from `/proc` with
  quit, network, disk I/O, disk space, NVIDIA and AMD GPU use, and the battery with its power draw.
- Windows and other systems: CPU and memory, and a note in the panel that says so.
- A status bar item with the current CPU and memory usage, updated at most every 5 seconds and only
  when a number changes. Pressing it opens the panel.
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
- On macOS, runs `/usr/bin/vm_stat` and `/usr/sbin/sysctl` for memory, `/bin/ps` for processes
  while the panel shows them, and `/usr/sbin/ioreg` once to tell performance cores from efficiency
  cores and, while the panel is open, for disk I/O and GPU use. While the panel is open it also
  runs `/usr/sbin/netstat` for network rates, and every 30 seconds `/sbin/route` for the default
  interface, `/bin/df` for other volumes and `/usr/bin/pmset` for the battery. While the Energy view
  is open it runs `/usr/bin/top` for energy impact and `/usr/bin/pmset` for the apps keeping the
  computer awake. It reads the startup disk's space with `statfs` and its name from `/Volumes`.
- On Linux, reads `/proc` and `/sys` files and `/etc/passwd` directly, and runs
  `/usr/bin/nvidia-smi` or `/usr/local/bin/nvidia-smi` when one of them exists, for NVIDIA GPU use.
- Quitting on Linux sends the same signals after the same checks; kernel threads are never quit.
- Sends `SIGTERM`, or `SIGKILL` when you force it, to a process you confirm in the panel, as your
  user, after the checks the README describes. This needs no new capability.
