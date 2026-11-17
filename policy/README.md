# Plugin policy files

Each plugin has one policy file here, `policy/<plugin id>.json`. It lists what the plugin's code may
use beyond plain JavaScript. `scripts/check-policy.mjs` reads it and rejects code that uses anything
else. A plugin with no policy file fails the check, even a theme with no code; give it `{}`.

The file lives outside the plugin folder on purpose: it is not shipped to users, and changing it
shows up in review as its own file.

No plugin exists yet, so there is no policy file yet.

## Format

```json
{
  "modules": ["node:child_process", "node:fs", "node:os"],
  "programs": ["/bin/ps", "/usr/bin/vm_stat"],
  "dynamicPrograms": [
    {
      "file": "src/orca-cli.ts",
      "function": "runOrcaCli",
      "reason": "Runs Orca's own CLI, whose path is found from the app bundle at run time"
    }
  ],
  "hosts": []
}
```

Every key is optional and defaults to an empty list. Unknown keys fail the check.

### `modules`

The Node builtin modules the plugin may import, written as `node:<name>`. An entry also allows its
subpaths: `node:fs` allows `node:fs/promises`. Code may import them with or without the `node:`
prefix.

These are never allowed, whatever the file says: `node:vm`, `node:worker_threads`, `node:module`,
`node:inspector`, `node:repl`, `node:wasi`, `node:v8` and `node:cluster`.

The network modules (`node:http`, `node:https`, `node:http2`, `node:net`, `node:tls`, `node:dgram`
and `node:dns`) are allowed only when `hosts` is not empty.

### `programs`

The programs the plugin may run with `execFile`, `execFileSync`, `spawn` or `spawnSync`, as
absolute paths. The call must name the program as a string literal at the call site, such as
`execFile('/bin/ps', args, options, callback)`. A constant or a variable does not count.

Shells, interpreters and tools that run other programs or reach the network are never allowed, even
if listed: `sh`, `bash`, `zsh` and the other shells, `env`, `xargs`, `find`, `sudo`, `curl`,
`wget`, `nc`, `ssh`, `osascript`, `open`, `awk`, `python`, `perl`, `ruby`, `node` and similar.
`exec`, `execSync` and `fork` are never allowed.

### `dynamicPrograms`

The one narrow exception to the literal-program rule. Some programs have no fixed path: Orca's own
CLI, for example, is found from `process.execPath` at run time. An entry names:

- `file`: one source file, as a path inside the plugin folder.
- `function`: one function that file exports, by name.
- `reason`: why the program cannot be a literal. Required; an empty reason fails the check.

Inside that function, and only there, `execFile` and `spawn` may take a program that is not a
literal. The `shell` option stays banned inside it, and every other call in the plugin, including
other calls in the same file, still needs a literal program from `programs`.

The check fails when an entry names a file or function that does not exist, or when the function
never runs a non-literal program (an unused exception). The maintainer reviews every exception and
the code of its function.

### `hosts`

The network hosts the plugin connects to, as lowercase host names. Each host must also be named in
the plugin's README. With an empty list, the plugin may not use `fetch`, `WebSocket`,
`XMLHttpRequest`, `EventSource`, `sendBeacon` or the network modules. The check cannot see which
host code connects to, so the README and review are what hold a plugin to its list.
