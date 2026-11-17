# OS Vitals

A system monitor for Orca. A panel in the right sidebar draws live CPU, memory and processes, and an
item in the status bar keeps the current numbers in view while you work.

**Status: in development.** This version reads CPU, memory and processes on macOS, and CPU on Linux
and Windows. Network, disk, GPU, battery, energy, quitting a process and the alerts arrive in later
versions; the platform table below says what works today.

## What it shows

- **Overview.**
  - The CPU card: total usage with its user and system parts over the last minutes, the load on
    each core (performance cores first, then efficiency cores, on Apple silicon), the load average
    and how long the system has been up.
  - The memory card: memory in use out of the total, split into app memory, wired, compressed and
    cached files, with memory pressure and swap. Memory in use is app memory plus wired plus
    compressed, the same formula Activity Monitor uses.
  - The five processes using the most CPU, with a link to the full list.
- **Processes.** Every process with its CPU, memory and PID. Filter by name or PID, sort by any
  column, and load 100 more rows at a time. Select a row (or press Enter or Space on it) to see its
  user, parent, start time, threads, CPU time, memory and command line. Escape closes the details.
- **Status bar.** `CPU 23% · MEM 61%`, updated at most every 5 seconds and only when a number
  changes. Its tooltip shows the load average and memory. Pressing it opens the panel.

The panel asks its worker for new readings every 2 seconds while it is open (the refresh interval
setting changes this). When you switch to another sidebar tab or close the sidebar, Orca removes
the panel and the polling stops with it. The process list is read only while the panel shows it:
every 2 seconds in the Processes view, every 4 seconds for the Overview's top five.

## The access it asks for

When you install OS Vitals, Orca asks you to approve this list.

| Access                           | Why                                                                                                                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runs a worker (`trusted-worker`) | The panel cannot read the system. A Node process does it for the panel, as your user, with no administrator rights. Because the plugin has a status bar item, Orca keeps the worker running while the plugin is enabled |
| `settings:own`                   | Reads the settings below, which you change in Orca's Settings                                                                                                                                                           |
| `notifications:show`             | Shows the current numbers when the panel cannot be opened from the status bar. Later versions also use it for the memory alert                                                                                          |
| Panel `OS Vitals`                | The panel in the right sidebar                                                                                                                                                                                          |
| Status bar item `OS Vitals`      | The CPU and memory readings in the status bar                                                                                                                                                                           |
| Command `OS Vitals: Open panel`  | Opens the panel. The status bar item runs it when you press it                                                                                                                                                          |

### Programs it runs

| Program            | When                                                                                                     | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/usr/bin/vm_stat` | macOS, every 5 seconds while the status bar or alerts need it, and every refresh while the panel is open | Memory page counts: app memory, wired, compressed and cached files                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/usr/sbin/sysctl` | macOS, with every `vm_stat`                                                                              | Reads `hw.memsize`, `vm.swapusage` and `kern.memorystatus_vm_pressure_level`: total memory, swap and memory pressure                                                                                                                                                                                                                                                                                                                                                 |
| `/bin/ps`          | macOS, only while the panel shows processes, and when you open a process's details                       | `ps -A -o pid= -o ppid= -o uid= -o pcpu= -o rss= -o time= -o lstart= -o user= -o comm=` lists processes. For details, `ps -p <pid>` adds the command line and `ps -M -p <pid>` counts threads                                                                                                                                                                                                                                                                        |
| `/usr/sbin/ioreg`  | macOS, once when the worker starts                                                                       | `ioreg -p IODeviceTree -c IOPlatformDevice` tells performance cores from efficiency cores                                                                                                                                                                                                                                                                                                                                                                            |
| Orca's own CLI     | Only when you press the status bar item or run the command                                               | Orca has no call that opens a plugin's panel, but its CLI does. The worker runs `orca plugin list --json` to learn its own install key, then `orca plugin open <key> --panel os-vitals --json`. It runs the copy inside Orca's application folder (`Orca.app/Contents/Resources/bin/orca` on macOS, `resources/bin/orca-ide` beside Orca on Linux), never one found on `PATH`. If it cannot find or run it, it shows a notification with the current numbers instead |

Every program runs directly by its full path, without a shell, with `LC_ALL=C`, a timeout of 1.5
seconds (10 seconds for Orca's CLI) and a cap on its output. A program that fails three times in a
row turns its section off instead of failing the whole reading. None of them needs administrator
rights.

### What it reads

| Source                                                                     | What for                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Node's `os` module: CPU times, load average, uptime, total and free memory | The CPU card, the status bar, and memory on Windows                       |
| The programs above                                                         | Memory, processes and core types on macOS                                 |
| Its own file path                                                          | Telling an installed copy from a development copy when it opens its panel |

Process names and command lines are shown in the panel as plain text and never leave your machine.

### What it never does

- No network access. It connects to nothing, and the panel's frame has no network either.
- No telemetry, analytics or data collection. Readings stay in the worker's memory for the history
  length you choose and are gone when the worker stops.
- It writes no files.

## Settings

| Setting                          | Default        | What it does                                                                                                                  |
| -------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Refresh interval                 | 2 seconds      | How often the panel updates while it is open: 1, 2 or 5 seconds                                                               |
| History length                   | 5 minutes      | How far back the charts reach: 1, 5 or 15 minutes                                                                             |
| Status bar                       | CPU and memory | CPU and memory, CPU, memory, or hidden                                                                                        |
| Sample while the panel is closed | On             | Reads CPU and memory every 5 seconds for the status bar while the panel is closed. Off, it reads only while the panel is open |
| Memory alert                     | On             | Not built yet                                                                                                                 |
| Memory alert limit (%)           | 92             | Not built yet                                                                                                                 |
| CPU alert                        | Off            | Not built yet                                                                                                                 |
| CPU alert limit (%)              | 90             | Not built yet                                                                                                                 |
| Open on                          | Last used      | The view the panel opens on: the last one you used, Overview, or Processes                                                    |

## Platforms

In development: the table shows this version, not the planned 1.0.

| Feature                                     | macOS   | Linux   | Windows and others                        |
| ------------------------------------------- | ------- | ------- | ----------------------------------------- |
| CPU total, user, system                     | Yes     | Yes     | Yes                                       |
| Per-core load                               | Yes     | Yes     | Yes                                       |
| Performance and efficiency cores            | Yes     | No      | No                                        |
| Load average                                | Yes     | Yes     | No                                        |
| Uptime                                      | Yes     | Yes     | Yes                                       |
| Memory                                      | Yes     | Not yet | Used and free only                        |
| Processes and their details                 | Yes     | Not yet | No                                        |
| Status bar item                             | Yes     | Yes     | Yes                                       |
| Opening the panel from the status bar       | Yes     | Yes     | No: shows a notification with the numbers |
| Network, disk, GPU, battery, energy, alerts | Not yet | Not yet | No                                        |

OS Vitals needs the Orca desktop app. Orca's browser client loads a panel as a single inlined
document, and this panel is made of several files.

## Development

From the repository root:

```sh
orca plugin validate plugins/os-vitals --json
orca plugin test plugins/os-vitals --json      # src/worker.test.ts, with orca/testing
node --test 'tests/os-vitals/**/*.test.ts'      # unit tests
node tools/os-vitals/smoke.ts                   # samples this machine
node tools/os-vitals/serve.ts                   # the panel in a browser with a fake Orca
```

`tools/os-vitals/serve.ts` serves `tools/os-vitals/harness.html`, which loads the real panel files
with a fake `window.orca` that answers with generated readings. `?scenario=` picks `loading`,
`error`, `unsupported`, `windows`, `flaky`, `empty` or `pressure`, `?theme=light` the light theme,
`?view=processes` the Processes view, and `?act=` runs steps after load (`tab:Processes`,
`filter:<text>`, `select:<name>`, separated by commas). The `t` key switches theme.
`tools/os-vitals/gallery.html` shows several widths and states side by side.
