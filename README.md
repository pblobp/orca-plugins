# Orca plugins

[![CI](https://github.com/pblobp/orca-plugins/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/pblobp/orca-plugins/actions/workflows/ci.yml)
[![CodeQL](https://github.com/pblobp/orca-plugins/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/pblobp/orca-plugins/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/pblobp/orca-plugins/badge)](https://scorecard.dev/viewer/?uri=github.com/pblobp/orca-plugins)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Free, open-source plugins for the [Orca](https://github.com/stablyai/orca) desktop app. They collect
no data about you.

![OS Vitals, a system monitor in Orca's sidebar: the Overview in the dark theme and the Network view in the light theme](plugins/os-vitals/media/cover.png)

## Plugins

| Plugin                                   | What it adds                                                                                                                    | Version                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [OS Vitals](plugins/os-vitals/README.md) | A system monitor in the sidebar and the status bar: CPU, memory, network, disk, GPU, battery and processes, with a memory alert | [1.0.0](https://orca.dev/plugins/pblobp/orca-plugins/os-vitals) |

## Screenshots

| Overview                                                                                                               | Processes                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| ![The Overview in the dark theme, with CPU, memory, network, disk and GPU cards](plugins/os-vitals/media/overview.png) | ![The Processes view in the dark theme, with the details drawer open for one process](plugins/os-vitals/media/processes.png)      |
| **CPU and Memory**                                                                                                     | **Network and Energy**                                                                                                            |
| ![The CPU view with a chart tooltip, and the Memory view, in the light theme](plugins/os-vitals/media/details.png)     | ![The Network view with a chart tooltip, and the Energy view with battery and energy impact](plugins/os-vitals/media/network.png) |

## Install

Install from Orca's Settings, under Plugins, or with Orca's CLI:

```sh
orca plugin install pblobp.os-vitals --catalog community
```

Orca shows the access a plugin asks for and waits for your approval before it runs any code.

## Security

A plugin with a worker runs as you, with no sandbox, and Orca updates installed plugins by itself.
So every change here goes through a pull request with required checks, and only the maintainer can
tag a release. Each plugin's README lists the access it asks for, and `policy/<plugin id>.json`
lists the programs and Node modules it may use. [SECURITY.md](SECURITY.md) says what these rules
protect, what they cannot, and how to report a problem.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), and propose a new plugin in an issue before you write it.
Questions and bug reports: [SUPPORT.md](SUPPORT.md).

## License

[MIT](LICENSE)
