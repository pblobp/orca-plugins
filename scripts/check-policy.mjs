#!/usr/bin/env node
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { isIPv4, isIPv6 } from 'node:net'
import { hostname, userInfo } from 'node:os'
import { extname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import ts from 'typescript'
import {
  PLUGIN_ID,
  REPOSITORY_URL,
  commitExists,
  fileAt,
  finish,
  jsonAt,
  pluginIds,
  readJson,
  repoRoot,
  sameJson,
  workingFiles
} from './lib/common.mjs'

export const LIMITS = {
  entries: 2000,
  totalBytes: 50 * 1024 * 1024,
  transpiledBytes: 1024 * 1024,
  lineLength: 200
}

const TRANSPILED = new Set(['.ts', '.tsx', '.mts', '.jsx'])
const CODE_KINDS = {
  '.ts': ts.ScriptKind.TS,
  '.mts': ts.ScriptKind.TS,
  '.cts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
  '.js': ts.ScriptKind.JS,
  '.mjs': ts.ScriptKind.JS,
  '.cjs': ts.ScriptKind.JS,
  '.jsx': ts.ScriptKind.JSX
}
const HTML = new Set(['.html', '.htm'])
const READABLE = new Set([...Object.keys(CODE_KINDS), ...HTML, '.css', '.json'])
const REQUIRED_FILES = ['orca-plugin.json', 'README.md', 'CHANGELOG.md', 'LICENSE']
const BLOCKED_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb'
])
const BLOCKED_EXTENSIONS = new Set([
  '.ttf',
  '.otf',
  '.ttc',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.zst',
  '.7z',
  '.rar',
  '.jar',
  '.war',
  '.asar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.node',
  '.wasm',
  '.bin',
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',
  '.msi',
  '.app',
  '.iso',
  '.a',
  '.o',
  '.class',
  '.pyc'
])
const MEDIA = {
  '.png': (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.webp': (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  '.woff': (b) => b.toString('latin1', 0, 4) === 'wOFF',
  '.woff2': (b) => b.toString('latin1', 0, 4) === 'wOF2'
}

export const ALWAYS_FORBIDDEN_MODULES = new Set([
  'vm',
  'worker_threads',
  'module',
  'inspector',
  'repl',
  'wasi',
  'v8',
  'cluster'
])
export const NETWORK_MODULES = new Set(['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns'])
const NETWORK_GLOBALS = new Set([
  'fetch',
  'WebSocket',
  'XMLHttpRequest',
  'EventSource',
  'WebTransport',
  'RTCPeerConnection',
  'sendBeacon'
])
const CODE_GLOBALS = new Set([
  'eval',
  'Function',
  'WebAssembly',
  'Worker',
  'SharedWorker',
  'importScripts',
  'createRequire'
])
const GLOBAL_OBJECTS = new Set(['globalThis', 'global', 'window', 'self', 'process'])
const BARE_GLOBALS = new Set(['globalThis', 'global', 'window', 'process'])
const HTML_SINKS = new Set([
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
  'srcdoc',
  'setHTMLUnsafe',
  'parseHTMLUnsafe',
  'createContextualFragment',
  'dangerouslySetInnerHTML'
])
const PROCESS_FORBIDDEN = new Set(['binding', '_linkedBinding', 'dlopen', 'mainModule', 'execve'])
const ANYWHERE_FORBIDDEN = new Set(['constructor', 'getBuiltinModule', 'dlopen', '_linkedBinding'])
const FORBIDDEN_STRINGS = new Set([...HTML_SINKS, ...ANYWHERE_FORBIDDEN, 'eval'])
const CHILD_PROCESS_MODULES = new Set(['child_process', 'node:child_process'])
const CHILD_PROCESS_CHECKED = new Set(['execFile', 'execFileSync', 'spawn', 'spawnSync'])
const CHILD_PROCESS_BY_NAME = new Set([...CHILD_PROCESS_CHECKED, 'execSync'])
const TIMERS = new Set(['setTimeout', 'setInterval', 'setImmediate'])
export const FORBIDDEN_PROGRAMS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'mksh',
  'fish',
  'csh',
  'tcsh',
  'busybox',
  'env',
  'xargs',
  'find',
  'nohup',
  'nice',
  'timeout',
  'sudo',
  'doas',
  'su',
  'curl',
  'wget',
  'nc',
  'ncat',
  'netcat',
  'socat',
  'telnet',
  'ftp',
  'ssh',
  'scp',
  'sftp',
  'rsync',
  'osascript',
  'open',
  'xdg-open',
  'awk',
  'gawk',
  'mawk',
  'deno',
  'bun',
  'powershell',
  'pwsh',
  'cmd'
])
const INTERPRETER = /^(python|perl|ruby|php|lua|node|tclsh)[\d.]*$/
const POLICY_KEYS = ['modules', 'programs', 'dynamicPrograms', 'hosts']
const EXCEPTION_KEYS = ['file', 'function', 'reason']
const ABSOLUTE_PROGRAM = /^\/(?:[A-Za-z0-9._+-]+\/)*[A-Za-z0-9._+-]+$/
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const CODE_URL = /^\s*(?:javascript|vbscript|data):/i
const ACCESS_FIELDS = [
  ['execution', (m) => m.execution],
  ['main', (m) => m.main],
  ['capabilities', (m) => m.capabilities],
  ['commands', (m) => m.contributes?.commands],
  ['hooks', (m) => m.contributes?.hooks],
  ['events', (m) => m.contributes?.events],
  ['keybindings', (m) => m.contributes?.keybindings],
  ['panels', (m) => m.contributes?.panels],
  ['customEditors', (m) => m.contributes?.customEditors]
]

export function emptyPolicy() {
  return { modules: [], programs: [], dynamicPrograms: [], hosts: [] }
}

export function forbiddenProgram(path) {
  const name = path
    .split('/')
    .pop()
    .toLowerCase()
    .replace(/\.exe$/, '')
  return FORBIDDEN_PROGRAMS.has(name) || INTERPRETER.test(name)
}

export function validatePolicy(raw, file, problems) {
  const policy = emptyPolicy()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push(`${file}: must be a JSON object`)
    return policy
  }
  for (const key of Object.keys(raw)) {
    if (!POLICY_KEYS.includes(key)) problems.push(`${file}: unknown key "${key}"`)
  }
  const list = (key) => {
    if (raw[key] === undefined) return []
    if (Array.isArray(raw[key])) return raw[key]
    problems.push(`${file}: ${key} must be an array`)
    return []
  }
  for (const entry of list('modules')) {
    const text = JSON.stringify(entry)
    if (typeof entry !== 'string' || !entry.startsWith('node:') || !isBuiltin(entry)) {
      problems.push(`${file}: module ${text} must be a Node builtin written as "node:<name>"`)
    } else if (ALWAYS_FORBIDDEN_MODULES.has(entry.slice(5).split('/')[0])) {
      problems.push(`${file}: module ${entry} is never allowed`)
    } else if (policy.modules.includes(entry)) {
      problems.push(`${file}: module ${entry} is listed twice`)
    } else {
      policy.modules.push(entry)
    }
  }
  for (const entry of list('programs')) {
    const text = JSON.stringify(entry)
    if (
      typeof entry !== 'string' ||
      !ABSOLUTE_PROGRAM.test(entry) ||
      entry.split('/').some((part) => part === '.' || part === '..')
    ) {
      problems.push(`${file}: program ${text} must be an absolute path`)
    } else if (forbiddenProgram(entry)) {
      problems.push(`${file}: program ${entry} is never allowed`)
    } else if (policy.programs.includes(entry)) {
      problems.push(`${file}: program ${entry} is listed twice`)
    } else {
      policy.programs.push(entry)
    }
  }
  for (const entry of list('hosts')) {
    if (typeof entry !== 'string' || !HOST.test(entry)) {
      problems.push(`${file}: host ${JSON.stringify(entry)} must be a lowercase host name`)
    } else if (!policy.hosts.includes(entry)) {
      policy.hosts.push(entry)
    }
  }
  list('dynamicPrograms').forEach((entry, index) => {
    const where = `${file}: dynamicPrograms[${index}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${where} must be an object with file, function and reason`)
      return
    }
    let valid = true
    for (const key of Object.keys(entry)) {
      if (!EXCEPTION_KEYS.includes(key)) {
        problems.push(`${where}: unknown key "${key}"`)
        valid = false
      }
    }
    const target = entry.file
    if (
      typeof target !== 'string' ||
      target === '' ||
      posix.isAbsolute(target) ||
      posix.normalize(target) !== target ||
      target.split('/').includes('..') ||
      !(extname(target) in CODE_KINDS)
    ) {
      problems.push(`${where}: file must be one source file, as a path inside the plugin`)
      valid = false
    }
    if (typeof entry.function !== 'string' || !IDENTIFIER.test(entry.function)) {
      problems.push(`${where}: function must be one function name`)
      valid = false
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      problems.push(`${where}: reason is required`)
      valid = false
    }
    if (valid) {
      policy.dynamicPrograms.push({ file: target, function: entry.function, reason: entry.reason })
    }
  })
  const network = policy.modules.filter((m) => NETWORK_MODULES.has(m.slice(5).split('/')[0]))
  if (network.length > 0 && policy.hosts.length === 0) {
    problems.push(`${file}: ${network.join(', ')} need the hosts the plugin connects to in "hosts"`)
  }
  return policy
}

function isTypeOnlyImport(node) {
  return Boolean(node.importClause?.isTypeOnly)
}

function hasModifier(node, kind) {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === kind))
}

function unwrap(node) {
  let current = node
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isAwaitExpression(current))
  ) {
    current = current.expression
  }
  return current
}

function literalText(node) {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
    return node.text
  }
  return undefined
}

function isReference(node) {
  const parent = node.parent
  if (!parent) return true
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false
  if (ts.isQualifiedName(parent) || ts.isMetaProperty(parent)) return false
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isEnumMember(parent) ||
      ts.isJsxAttribute(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isParameter(parent) ||
      ts.isTypeParameterDeclaration(parent) ||
      ts.isLabeledStatement(parent)) &&
    parent.name === node
  ) {
    return false
  }
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) {
    return false
  }
  if (ts.isBreakOrContinueStatement(parent) && parent.label === node) return false
  if (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isNamespaceExport(parent) ||
    ts.isImportEqualsDeclaration(parent)
  ) {
    return false
  }
  return true
}

function findExportedFunction(sourceFile, name) {
  const exportedNames = new Set()
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exportedNames.add((element.propertyName ?? element.name).text)
      }
    }
  }
  for (const statement of sourceFile.statements) {
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword) || exportedNames.has(name)
    if (!exported) continue
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body) {
      return statement
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer && unwrap(declaration.initializer)
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          return init
        }
      }
    }
  }
  return null
}

function scriptKindFor(file) {
  return CODE_KINDS[extname(file).toLowerCase()] ?? ts.ScriptKind.TS
}

export function checkSource(text, options) {
  const file = options.file
  const policy = options.policy ?? emptyPolicy()
  const lineOffset = options.lineOffset ?? 0
  const kind = options.kind ?? scriptKindFor(file)
  const problems = []
  const used = new Set()
  const found = new Set()
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const lineOf = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1 + lineOffset
  const add = (node, message) => problems.push({ line: lineOf(node), message })

  const diagnostics = sourceFile.parseDiagnostics ?? []
  if (diagnostics.length > 0) {
    const first = diagnostics[0]
    const line = sourceFile.getLineAndCharacterOfPosition(first.start ?? 0).line + 1 + lineOffset
    const message = ts.flattenDiagnosticMessageText(first.messageText, ' ')
    return { problems: [{ line, message: `does not parse: ${message}` }], used, found }
  }

  const hosts = policy.hosts.length > 0
  const consts = new Map()
  const cpNamespaces = new Set()
  const cpFunctions = new Map()

  const exceptions = []
  for (const entry of policy.dynamicPrograms) {
    if (entry.file !== file) continue
    const key = `${entry.file}#${entry.function}`
    const target = findExportedFunction(sourceFile, entry.function)
    if (target) {
      found.add(key)
      exceptions.push({ key, start: target.getStart(sourceFile), end: target.getEnd() })
    }
  }

  const isChildProcessLoad = (expression) => {
    const node = unwrap(expression)
    if (!node || !ts.isCallExpression(node)) return false
    const isLoader =
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require')
    return isLoader && CHILD_PROCESS_MODULES.has(literalText(node.arguments[0]) ?? '')
  }

  const collectConsts = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      node.parent.flags & ts.NodeFlags.Const
    ) {
      consts.set(node.name.text, consts.has(node.name.text) ? null : node.initializer)
    }
    ts.forEachChild(node, collectConsts)
  }
  collectConsts(sourceFile)

  const collect = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      !isTypeOnlyImport(node) &&
      CHILD_PROCESS_MODULES.has(literalText(node.moduleSpecifier) ?? '')
    ) {
      const clause = node.importClause
      if (clause?.name) cpNamespaces.add(clause.name.text)
      const bindings = clause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) cpNamespaces.add(bindings.name.text)
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue
          cpFunctions.set(element.name.text, (element.propertyName ?? element.name).text)
        }
      }
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      CHILD_PROCESS_MODULES.has(literalText(node.moduleReference.expression) ?? '')
    ) {
      cpNamespaces.add(node.name.text)
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrap(node.initializer)
      const fromModule = isChildProcessLoad(init)
      const fromNamespace = ts.isIdentifier(init) && cpNamespaces.has(init.text)
      if (fromModule && ts.isIdentifier(node.name)) cpNamespaces.add(node.name.text)
      if ((fromModule || fromNamespace) && ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const key = element.propertyName ?? element.name
          if (ts.isIdentifier(element.name) && ts.isIdentifier(key)) {
            cpFunctions.set(element.name.text, key.text)
          }
        }
      }
    }
    ts.forEachChild(node, collect)
  }
  collect(sourceFile)
  collect(sourceFile)

  const fold = (node, depth = 0) => {
    if (!node || depth > 16) return undefined
    const literal = literalText(node)
    if (literal !== undefined) return literal
    if (ts.isNumericLiteral(node)) return String(Number(node.text))
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      return fold(node.expression, depth + 1)
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = fold(node.left, depth + 1)
      const right = fold(node.right, depth + 1)
      return left === undefined || right === undefined ? undefined : left + right
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text
      for (const span of node.templateSpans) {
        const part = fold(span.expression, depth + 1)
        if (part === undefined) return undefined
        value += part + span.literal.text
      }
      return value
    }
    if (ts.isIdentifier(node)) {
      const init = consts.get(node.text)
      return init ? fold(init, depth + 1) : undefined
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const target = unwrap(node.expression.expression)
      const args = node.arguments.map((arg) => fold(arg, depth + 1))
      if (args.some((arg) => arg === undefined)) return undefined
      if (method === 'join' && ts.isArrayLiteralExpression(target)) {
        const parts = target.elements.map((element) => fold(element, depth + 1))
        if (parts.some((part) => part === undefined)) return undefined
        return parts.join(args.length > 0 ? args[0] : ',')
      }
      if (method === 'fromCharCode' && ts.isIdentifier(target) && target.text === 'String') {
        const codes = args.map(Number)
        return codes.some(Number.isNaN) ? undefined : String.fromCharCode(...codes)
      }
      const base = fold(target, depth + 1)
      if (base === undefined) return undefined
      if (method === 'concat') return base + args.join('')
      if (['toLowerCase', 'toUpperCase', 'trim'].includes(method) && args.length === 0) {
        return base[method]()
      }
      return undefined
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'atob' &&
      node.arguments.length === 1
    ) {
      const value = fold(node.arguments[0], depth + 1)
      return value === undefined ? undefined : Buffer.from(value, 'base64').toString('latin1')
    }
    return undefined
  }

  const containsString = (node) => {
    let hit = false
    const walk = (child) => {
      if (hit) return
      if (
        ts.isStringLiteral(child) ||
        ts.isNoSubstitutionTemplateLiteral(child) ||
        ts.isTemplateExpression(child)
      ) {
        hit = true
        return
      }
      ts.forEachChild(child, walk)
    }
    walk(node)
    return hit
  }

  const isDirectCallee = (node) =>
    ts.isCallExpression(node.parent) && node.parent.expression === node

  const exceptionAt = (node) => {
    const position = node.getStart(sourceFile)
    return exceptions.find((range) => position >= range.start && position < range.end)
  }

  const checkSpecifier = (specifier, node) => {
    if (/^\.\.?(\/|$)/.test(specifier)) {
      const target = posix.normalize(posix.join(posix.dirname(file), specifier))
      if (target === '..' || target.startsWith('../')) {
        add(node, `import of ${specifier} points outside the plugin`)
      }
      return
    }
    if (specifier === 'orca' || specifier.startsWith('orca/')) return
    if (specifier.startsWith('node:') || isBuiltin(specifier)) {
      const name = specifier.replace(/^node:/, '')
      const base = name.split('/')[0]
      if (!isBuiltin(`node:${name}`)) {
        add(node, `${specifier} is not a Node builtin`)
      } else if (ALWAYS_FORBIDDEN_MODULES.has(base)) {
        add(node, `node:${base} is never allowed`)
      } else if (
        !policy.modules.includes(`node:${name}`) &&
        !policy.modules.includes(`node:${base}`)
      ) {
        add(node, `node:${name} is not on this plugin's module allowlist`)
      }
      return
    }
    add(node, `${specifier} is not a file in the plugin, a Node builtin or orca`)
  }

  const checkName = (name, node, object) => {
    if (HTML_SINKS.has(name)) add(node, `${name} puts text into HTML; use textContent or DOM nodes`)
    if ((name === 'write' || name === 'writeln') && object) {
      const target = unwrap(object)
      const isDocument =
        (ts.isIdentifier(target) && target.text === 'document') ||
        (ts.isPropertyAccessExpression(target) &&
          ['document', 'contentDocument', 'ownerDocument'].includes(target.name.text))
      if (isDocument) add(node, `document.${name} puts text into HTML`)
    }
    if (ANYWHERE_FORBIDDEN.has(name)) add(node, `.${name} is not allowed`)
    const owner = object && unwrap(object)
    if (owner && ts.isIdentifier(owner)) {
      if (owner.text === 'process' && PROCESS_FORBIDDEN.has(name)) {
        add(node, `process.${name} is not allowed`)
      }
      if (GLOBAL_OBJECTS.has(owner.text) && owner.text !== 'process') {
        if (CODE_GLOBALS.has(name) || name === 'require') {
          add(node, `${owner.text}.${name} runs or loads code`)
        }
        if (NETWORK_GLOBALS.has(name) && !hosts) {
          add(node, `${owner.text}.${name} uses the network, and the policy lists no hosts`)
        }
      }
    }
    if (name === 'sendBeacon' && !hosts) add(node, 'sendBeacon uses the network')
  }

  const childProcessCallee = (callee) => {
    const node = unwrap(callee)
    if (ts.isIdentifier(node)) {
      if (cpFunctions.has(node.text)) return cpFunctions.get(node.text)
      if (CHILD_PROCESS_BY_NAME.has(node.text)) return node.text
      return null
    }
    if (ts.isPropertyAccessExpression(node)) {
      const target = unwrap(node.expression)
      const name = node.name.text
      if (ts.isIdentifier(target) && cpNamespaces.has(target.text)) return name
      if (isChildProcessLoad(target)) return name
      if (CHILD_PROCESS_BY_NAME.has(name)) return name
    }
    return null
  }

  const checkChildProcessCall = (name, node) => {
    if (!CHILD_PROCESS_CHECKED.has(name)) {
      add(
        node,
        `child_process ${name} is not allowed; use execFile or spawn with an allowed program`
      )
      return
    }
    const program = literalText(node.arguments[0])
    if (program !== undefined) {
      if (forbiddenProgram(program)) add(node, `${name}: ${program} is never allowed`)
      else if (!policy.programs.includes(program)) {
        add(node, `${name}: ${program} is not on this plugin's program allowlist`)
      }
      return
    }
    const exception = exceptionAt(node)
    if (exception) used.add(exception.key)
    else add(node, `${name} needs a string-literal program from the allowlist`)
  }

  const visit = (node) => {
    if (ts.isHeritageClause(node)) {
      if (node.token === ts.SyntaxKind.ExtendsKeyword) {
        for (const type of node.types) visit(type.expression)
      }
      return
    }
    if (ts.isExpressionWithTypeArguments(node)) {
      visit(node.expression)
      return
    }
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      return
    }
    if (
      ts.isModuleDeclaration(node) &&
      (hasModifier(node, ts.SyntaxKind.DeclareKeyword) || ts.isStringLiteral(node.name))
    ) {
      return
    }
    if (ts.isImportDeclaration(node)) {
      if (!isTypeOnlyImport(node)) checkSpecifier(literalText(node.moduleSpecifier) ?? '', node)
      return
    }
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && !node.isTypeOnly) {
        checkSpecifier(literalText(node.moduleSpecifier) ?? '', node)
      }
      return
    }
    if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference) && !node.isTypeOnly) {
        const specifier = literalText(node.moduleReference.expression)
        if (specifier === undefined) add(node, 'require needs a string literal')
        else checkSpecifier(specifier, node)
      }
      return
    }

    if (ts.isIdentifier(node) && isReference(node)) {
      const name = node.text
      const parent = node.parent
      if (CODE_GLOBALS.has(name)) add(node, `${name} runs or loads code that review cannot see`)
      if (
        name === 'require' &&
        !(isDirectCallee(node) && literalText(parent.arguments[0]) !== undefined)
      ) {
        add(node, 'require may only be called with a string literal')
      }
      if (NETWORK_GLOBALS.has(name) && !hosts) {
        add(node, `${name} uses the network, and the policy lists no hosts`)
      }
      if (BARE_GLOBALS.has(name)) {
        const allowed =
          (ts.isPropertyAccessExpression(parent) && parent.expression === node) ||
          (ts.isElementAccessExpression(parent) && parent.expression === node) ||
          ts.isTypeOfExpression(parent)
        if (!allowed) add(node, `${name} may only be used as ${name}.<name>`)
      }
      if (cpNamespaces.has(name)) {
        const allowed =
          (ts.isPropertyAccessExpression(parent) && parent.expression === node) ||
          (ts.isElementAccessExpression(parent) && parent.expression === node) ||
          (ts.isVariableDeclaration(parent) &&
            parent.initializer === node &&
            ts.isObjectBindingPattern(parent.name))
        if (!allowed) add(node, 'use the child_process module only as <module>.<function>(...)')
      }
      if ((cpFunctions.has(name) || CHILD_PROCESS_BY_NAME.has(name)) && !isDirectCallee(node)) {
        add(node, `${name} must be called directly, not passed around or wrapped`)
      }
    }

    if (ts.isPropertyAccessExpression(node)) {
      checkName(node.name.text, node, node.expression)
      const target = unwrap(node.expression)
      const fromChildProcess =
        (ts.isIdentifier(target) && cpNamespaces.has(target.text)) || isChildProcessLoad(target)
      if (fromChildProcess && !isDirectCallee(node)) {
        add(node, `child_process ${node.name.text} must be called directly, not passed around`)
      } else if (CHILD_PROCESS_BY_NAME.has(node.name.text) && !isDirectCallee(node)) {
        add(node, `${node.name.text} must be called directly, not passed around or wrapped`)
      }
    }

    if (ts.isElementAccessExpression(node)) {
      const target = unwrap(node.expression)
      if (ts.isIdentifier(target) && GLOBAL_OBJECTS.has(target.text)) {
        add(node, `computed access on ${target.text} is not allowed`)
      } else if (
        (ts.isIdentifier(target) && cpNamespaces.has(target.text)) ||
        isChildProcessLoad(target)
      ) {
        add(node, 'computed access on the child_process module is not allowed')
      }
      const key = fold(node.argumentExpression)
      if (key !== undefined) checkName(key, node, node.expression)
      else if (containsString(node.argumentExpression)) {
        add(node, 'a property name built from strings hides what it reaches')
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = literalText(node.arguments[0])
        if (specifier === undefined) add(node, 'import() needs a string literal')
        else checkSpecifier(specifier, node)
      } else if (ts.isIdentifier(callee) && callee.text === 'require') {
        const specifier = literalText(node.arguments[0])
        if (specifier !== undefined) checkSpecifier(specifier, node)
      }
      const cpName = childProcessCallee(callee)
      if (cpName) checkChildProcessCall(cpName, node)
      const calleeNode = unwrap(callee)
      const calleeName = ts.isIdentifier(calleeNode)
        ? calleeNode.text
        : ts.isPropertyAccessExpression(calleeNode)
          ? calleeNode.name.text
          : null
      if (calleeName && TIMERS.has(calleeName)) {
        const first = node.arguments[0]
        if (first && (fold(first) !== undefined || containsString(first))) {
          add(node, `${calleeName} with a string runs it as code`)
        }
      }
      if (calleeName === 'setAttribute' || calleeName === 'setAttributeNS') {
        const attribute = fold(node.arguments[calleeName === 'setAttribute' ? 0 : 1])
        if (attribute !== undefined && /^(on|srcdoc$)/i.test(attribute)) {
          add(node, `setting the ${attribute} attribute runs or embeds code`)
        }
      }
      if (calleeName === 'createElement' || calleeName === 'createElementNS') {
        const tag = fold(node.arguments[calleeName === 'createElement' ? 0 : 1])
        if (tag !== undefined && tag.toLowerCase() === 'script') {
          add(node, 'creating a script element loads code')
        }
      }
    }

    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const key = ts.isComputedPropertyName(node.name)
        ? fold(node.name.expression)
        : ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
          ? node.name.text
          : undefined
      if (key === 'shell') {
        const isFalse =
          ts.isPropertyAssignment(node) && node.initializer.kind === ts.SyntaxKind.FalseKeyword
        if (!isFalse) add(node, 'the shell option must not be set; run the program directly')
      }
      if (key !== undefined && HTML_SINKS.has(key)) {
        add(node, `${key} puts text into HTML; use textContent or DOM nodes`)
      }
    }

    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && HTML_SINKS.has(node.name.text)) {
      add(node, `${node.name.text} puts text into HTML`)
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (FORBIDDEN_STRINGS.has(node.text)) add(node, `the string "${node.text}" is not allowed`)
      if (CODE_URL.test(node.text))
        add(node, 'javascript:, vbscript: and data: URLs can carry code')
    }

    const isTopConcat =
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      !(
        ts.isBinaryExpression(node.parent) &&
        node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken
      )
    const isBuilt =
      isTopConcat ||
      ts.isTemplateExpression(node) ||
      (ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ['join', 'fromCharCode', 'concat'].includes(node.expression.name.text)) ||
      (ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'atob')
    if (isBuilt) {
      const value = fold(node)
      if (
        value !== undefined &&
        (FORBIDDEN_STRINGS.has(value) ||
          CODE_GLOBALS.has(value) ||
          value === 'require' ||
          (!hosts && NETWORK_GLOBALS.has(value)) ||
          CODE_URL.test(value))
      ) {
        add(node, `"${value}" is assembled from pieces, which hides it`)
      }
    }

    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  const seen = new Set()
  const unique = problems.filter((problem) => {
    const key = `${problem.line}\0${problem.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  unique.sort((a, b) => a.line - b.line)
  return { problems: unique, used, found }
}

function lineAt(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

export function checkHtml(text, options) {
  const file = options.file
  const problems = []
  const used = new Set()
  const found = new Set()
  const script = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
  let match
  let closed = 0
  while ((match = script.exec(text)) !== null) {
    closed++
    const line = lineAt(text, match.index)
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[1])
    if (src) {
      const url = src[1] ?? src[2] ?? src[3]
      const target = posix.normalize(posix.join(posix.dirname(file), url))
      if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/') || target.startsWith('../')) {
        problems.push({ line, message: `script ${url} is not a file inside the plugin` })
      }
      continue
    }
    if (match[2].trim() === '') continue
    const bodyStart = match.index + match[0].indexOf('>') + 1
    const inner = checkSource(match[2], {
      file,
      kind: ts.ScriptKind.JS,
      policy: options.policy,
      lineOffset: lineAt(text, bodyStart) - 1
    })
    problems.push(...inner.problems)
    for (const key of inner.used) used.add(key)
    for (const key of inner.found) found.add(key)
  }
  const opened = (text.match(/<script\b/gi) ?? []).length
  if (opened !== closed) problems.push({ line: 1, message: 'a <script> element is not closed' })
  const tag = /<[a-zA-Z][^>]*>/g
  while ((match = tag.exec(text)) !== null) {
    const line = lineAt(text, match.index)
    const handler = /\s(on[a-z]+|srcdoc)\s*=/i.exec(match[0])
    if (handler) {
      problems.push({ line, message: `the ${handler[1]} attribute runs or embeds code` })
    }
    if (
      /\s(?:href|src|action|formaction|xlink:href)\s*=\s*(?:["']\s*)?(?:javascript|vbscript):/i.test(
        match[0]
      )
    ) {
      problems.push({ line, message: 'javascript: and vbscript: URLs run code' })
    }
  }
  return { problems, used, found }
}

const PLACEHOLDER_HOMES = new Set(['user', 'example', 'shared'])
const PLACEHOLDER_HOSTS = new Set(['example', 'host'])
const GENERIC_WORDS = new Set(['user', 'root', 'runner', 'admin', 'example', 'localhost', 'mac'])

function allowedIPv4(address) {
  const [a, b, c] = address.split('.').map(Number)
  if (a === 0 || a === 127 || a === 255 || a >= 224) return true
  if (a === 192 && b === 0 && c === 2) return true
  if (a === 198 && b === 51 && c === 100) return true
  if (a === 203 && b === 0 && c === 113) return true
  return false
}

function allowedIPv6(address) {
  const value = address.toLowerCase()
  return (
    value === '::' ||
    value === '::1' ||
    value === 'fe80::1' ||
    value.startsWith('2001:db8:') ||
    value.startsWith('ff')
  )
}

function allowedMac(address) {
  const value = address.toLowerCase().replace(/-/g, ':')
  return (
    value === '00:00:00:00:00:00' ||
    value === 'ff:ff:ff:ff:ff:ff' ||
    value.startsWith('00:00:5e:00:53:')
  )
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function scanFixture(text, extraWords = []) {
  const problems = []
  const report = (index, message) => problems.push({ line: lineAt(text, index), message })
  const scan = (pattern, test) => {
    for (const match of text.matchAll(pattern)) test(match)
  }
  scan(/(?:\/Users|\/home|[A-Za-z]:\\Users)[\\/]([^\\/\s"'`:;,()<>]+)/g, (match) => {
    if (!PLACEHOLDER_HOMES.has(match[1].toLowerCase())) {
      report(match.index, `home path ${match[0]}; use /Users/user or /home/user`)
    }
  })
  scan(/(?<![0-9A-Fa-f:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:-])/g, (match) => {
    if (!allowedMac(match[0])) report(match.index, `MAC address ${match[0]}; use 00:00:5e:00:53:xx`)
  })
  scan(/(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/g, (match) => {
    if (isIPv4(match[0]) && !allowedIPv4(match[0])) {
      report(match.index, `IP address ${match[0]}; use 192.0.2.x, 198.51.100.x or 203.0.113.x`)
    }
  })
  scan(/(?<![0-9A-Za-z:.])[0-9A-Fa-f]*(?::[0-9A-Fa-f]*)+(?![0-9A-Za-z:])/g, (match) => {
    if ((match[0].match(/:/g) ?? []).length >= 2 && isIPv6(match[0]) && !allowedIPv6(match[0])) {
      report(match.index, `IPv6 address ${match[0]}; use the 2001:db8:: range`)
    }
  })
  scan(/\b([A-Za-z0-9][A-Za-z0-9-]*)\.(?:local|lan|home|localdomain|internal)\b/g, (match) => {
    if (!PLACEHOLDER_HOSTS.has(match[1].toLowerCase())) {
      report(match.index, `host name ${match[0]}; use host.local`)
    }
  })
  scan(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g, (match) => {
    if (!/@example\.(com|org|net)$/i.test(match[0])) report(match.index, 'email address')
  })
  for (const word of extraWords) {
    if (typeof word !== 'string' || word.length < 3 || GENERIC_WORDS.has(word.toLowerCase())) {
      continue
    }
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(word)}(?![A-Za-z0-9])`, 'gi')
    scan(pattern, (match) => report(match.index, `"${match[0]}" names this machine or its user`))
  }
  return problems
}

export function localWords() {
  if (process.env.CI) return []
  const words = []
  try {
    words.push(userInfo().username)
  } catch {}
  words.push(hostname().split('.')[0])
  return words.filter(Boolean)
}

export function accessLines(markdown) {
  const lines = []
  let level = 0
  for (const raw of (markdown ?? '').split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw)
    if (heading) {
      const title = heading[2].replace(/[\s#]+$/, '').toLowerCase()
      if (title === 'access') level = heading[1].length
      else if (level && heading[1].length <= level) level = 0
      continue
    }
    if (level && raw.trim() !== '') lines.push(raw.trim())
  }
  return lines
}

function linesAdded(before, after) {
  const counts = new Map()
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1)
  const added = []
  for (const line of after) {
    const left = counts.get(line) ?? 0
    if (left > 0) counts.set(line, left - 1)
    else added.push(line)
  }
  return added
}

function decodeText(buffer) {
  if (buffer.includes(0)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return null
  }
}

function checkLayout(root, ids, problems) {
  const plugins = join(root, 'plugins')
  if (existsSync(plugins)) {
    for (const name of readdirSync(plugins).sort()) {
      const stat = lstatSync(join(plugins, name))
      if (stat.isSymbolicLink()) problems.push(`plugins/${name}: symlinks are not allowed`)
      else if (!stat.isDirectory())
        problems.push(`plugins/${name}: only plugin folders belong in plugins/`)
      else if (!PLUGIN_ID.test(name)) {
        problems.push(
          `plugins/${name}: a plugin folder name is lowercase letters, digits and dashes`
        )
      } else if (!existsSync(join(plugins, name, 'orca-plugin.json'))) {
        problems.push(`plugins/${name}: has no orca-plugin.json`)
      }
    }
  }
  const policies = join(root, 'policy')
  if (existsSync(policies)) {
    for (const name of readdirSync(policies).sort()) {
      if (name === 'README.md') continue
      const match = /^(.+)\.json$/.exec(name)
      if (!match) problems.push(`policy/${name}: only README.md and <plugin id>.json belong here`)
      else if (!ids.includes(match[1])) problems.push(`policy/${name}: no plugin has this id`)
    }
  }
}

function checkPlugin(root, id, problems) {
  const dir = `plugins/${id}`
  const manifest = readJson(join(root, dir, 'orca-plugin.json'))
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    problems.push(`${dir}/orca-plugin.json: missing or not valid JSON`)
  } else {
    if (manifest.id !== id) problems.push(`${dir}/orca-plugin.json: id must be "${id}"`)
    if (manifest.license !== 'MIT') problems.push(`${dir}/orca-plugin.json: license must be "MIT"`)
    if (manifest.repository !== REPOSITORY_URL) {
      problems.push(`${dir}/orca-plugin.json: repository must be "${REPOSITORY_URL}"`)
    }
  }
  if (/^orca-/i.test(id)) problems.push(`${dir}: ids starting with "orca-" are reserved by Orca`)
  for (const name of REQUIRED_FILES) {
    const path = join(root, dir, name)
    if (!existsSync(path) || !lstatSync(path).isFile()) problems.push(`${dir}/${name}: required`)
  }
  const license = join(root, dir, 'LICENSE')
  if (existsSync(license) && lstatSync(license).isFile()) {
    if (!readFileSync(license).equals(readFileSync(join(root, 'LICENSE')))) {
      problems.push(`${dir}/LICENSE: must be a copy of the repository's LICENSE`)
    }
  }

  const policyFile = `policy/${id}.json`
  const rawPolicy = readJson(join(root, policyFile))
  let policy = emptyPolicy()
  if (rawPolicy === null) problems.push(`${policyFile}: missing; every plugin needs one`)
  else if (rawPolicy === undefined) problems.push(`${policyFile}: not valid JSON`)
  else policy = validatePolicy(rawPolicy, policyFile, problems)

  const files = workingFiles(root, dir)
  const directories = new Set()
  const present = new Set()
  const used = new Set()
  const found = new Set()
  let count = 0
  let bytes = 0
  for (const path of files) {
    let stat
    try {
      stat = lstatSync(join(root, path))
    } catch {
      continue
    }
    const relative = path.slice(dir.length + 1)
    const parts = relative.split('/')
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'))
    count++
    present.add(relative)
    if (stat.isSymbolicLink()) {
      problems.push(`${path}: symlinks are not allowed`)
      continue
    }
    if (!stat.isFile()) {
      problems.push(`${path}: not a regular file`)
      continue
    }
    bytes += stat.size
    if (parts.includes('node_modules'))
      problems.push(`${path}: node_modules does not belong in a plugin`)
    if (parts.includes('.orca'))
      problems.push(`${path}: generated .orca files must not be committed`)
    if (parts.includes('.git')) problems.push(`${path}: .git does not belong in a plugin`)
    const name = parts[parts.length - 1]
    const ext = extname(name).toLowerCase()
    if (BLOCKED_NAMES.has(name)) {
      problems.push(`${path}: plugins have no npm dependencies, so no ${name}`)
    }
    if (BLOCKED_EXTENSIONS.has(ext)) {
      problems.push(`${path}: ${ext} files are not allowed (binaries, archives, TTF/OTF fonts)`)
      continue
    }
    if (TRANSPILED.has(ext) && stat.size > LIMITS.transpiledBytes) {
      problems.push(
        `${path}: over ${LIMITS.transpiledBytes} bytes, Orca's limit for a transpiled file`
      )
    }
    const buffer = readFileSync(join(root, path))
    if (MEDIA[ext]) {
      if (!MEDIA[ext](buffer)) problems.push(`${path}: content does not match its ${ext} extension`)
      continue
    }
    const text = decodeText(buffer)
    if (text === null) {
      problems.push(
        `${path}: binary or not UTF-8 text; only PNG, JPEG, WEBP, WOFF and WOFF2 may be binary`
      )
      continue
    }
    if (/\.min\.[a-z]+$/i.test(name)) problems.push(`${path}: minified files are not allowed`)
    if (READABLE.has(ext)) {
      const lines = text.split('\n')
      const long = lines.findIndex((line) => line.replace(/\r$/, '').length > LIMITS.lineLength)
      if (long !== -1) {
        problems.push(`${path}:${long + 1}: line longer than ${LIMITS.lineLength} characters`)
      }
    }
    let result = null
    if (ext in CODE_KINDS) result = checkSource(text, { file: relative, policy })
    else if (HTML.has(ext)) result = checkHtml(text, { file: relative, policy })
    if (result) {
      for (const problem of result.problems) {
        problems.push(`${path}:${problem.line}: ${problem.message}`)
      }
      for (const key of result.used) used.add(key)
      for (const key of result.found) found.add(key)
    }
  }
  const entries = count + directories.size
  if (entries > LIMITS.entries) {
    problems.push(`${dir}: ${entries} files and folders, over Orca's limit of ${LIMITS.entries}`)
  }
  if (bytes > LIMITS.totalBytes) {
    problems.push(`${dir}: ${bytes} bytes, over Orca's limit of ${LIMITS.totalBytes}`)
  }
  for (const entry of policy.dynamicPrograms) {
    const key = `${entry.file}#${entry.function}`
    if (!present.has(entry.file)) {
      problems.push(
        `${policyFile}: dynamicPrograms names ${dir}/${entry.file}, which does not exist`
      )
    } else if (!found.has(key)) {
      problems.push(
        `${policyFile}: dynamicPrograms names ${entry.function}, which ${dir}/${entry.file} does not export as a function`
      )
    } else if (!used.has(key)) {
      problems.push(
        `${policyFile}: dynamicPrograms entry for ${entry.function} is unused; remove it`
      )
    }
  }
  for (const host of policy.hosts) {
    const readme = join(root, dir, 'README.md')
    const text = existsSync(readme) ? readFileSync(readme, 'utf8') : ''
    if (!text.includes(host))
      problems.push(`${policyFile}: host ${host} is not named in ${dir}/README.md`)
  }
}

function checkFixtures(root, problems, extraWords) {
  if (!existsSync(join(root, 'tests'))) return
  const files = workingFiles(root, 'tests').filter((path) => path.split('/').includes('fixtures'))
  for (const path of files) {
    let buffer
    try {
      if (!lstatSync(join(root, path)).isFile()) {
        problems.push(`${path}: fixtures must be regular files`)
        continue
      }
      buffer = readFileSync(join(root, path))
    } catch {
      continue
    }
    const text = decodeText(buffer)
    if (text === null) {
      problems.push(
        `${path}: fixtures must be UTF-8 text, so they can be scanned for personal data`
      )
      continue
    }
    for (const problem of scanFixture(text, extraWords)) {
      problems.push(`${path}:${problem.line}: ${problem.message}`)
    }
  }
}

function checkAccess(root, base, ids, problems) {
  for (const id of ids) {
    const dir = `plugins/${id}`
    const now = readJson(join(root, dir, 'orca-plugin.json'))
    if (!now || typeof now !== 'object') continue
    const before = jsonAt(root, base, `${dir}/orca-plugin.json`)
    const changed =
      before && typeof before === 'object'
        ? ACCESS_FIELDS.filter(
            ([, pick]) => !sameJson(pick(before) ?? null, pick(now) ?? null)
          ).map(([name]) => name)
        : ['new plugin']
    if (changed.length === 0) continue
    const changelog = join(root, dir, 'CHANGELOG.md')
    const after = accessLines(existsSync(changelog) ? readFileSync(changelog, 'utf8') : '')
    const earlier = accessLines(fileAt(root, base, `${dir}/CHANGELOG.md`) ?? '')
    if (linesAdded(earlier, after).length === 0) {
      problems.push(
        `${dir}: access changed (${changed.join(', ')}), so ${dir}/CHANGELOG.md needs a new line under an "Access" heading`
      )
    }
  }
}

export function checkRepository(root, options = {}) {
  const problems = []
  const ids = pluginIds(root)
  checkLayout(root, ids, problems)
  for (const id of ids) checkPlugin(root, id, problems)
  checkFixtures(root, problems, options.extraWords ?? [])
  if (options.base) checkAccess(root, options.base, ids, problems)
  return { problems, ids }
}

function main() {
  const { values } = parseArgs({ options: { base: { type: 'string' } } })
  const root = repoRoot()
  if (values.base && !commitExists(root, values.base)) {
    throw new Error(`base ${values.base} is not a commit in this repository`)
  }
  const { problems, ids } = checkRepository(root, { base: values.base, extraWords: localWords() })
  const scope = values.base ? `, access compared with ${values.base}` : ''
  finish('check-policy', problems, `${ids.length} plugin(s) checked${scope}, no problems`)
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    main()
  } catch (error) {
    console.error(`check-policy: ${error.message}`)
    process.exitCode = 1
  }
}
