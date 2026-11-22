import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SandboxManager } from '../../src/sandbox/sandbox-manager.js'
import {
  NetworkConfigSchema,
  SandboxRuntimeConfigSchema,
} from '../../src/sandbox/sandbox-config.js'
import type { SandboxRuntimeConfig } from '../../src/sandbox/sandbox-config.js'
import type {
  MxcProbeOutput,
  MxcProcessHandle,
  MxcRequest,
  MxcSdk,
} from '../../src/sandbox/mxc-sandbox-utils.js'
import { isLinux, isMacOS, isWindows } from '../helpers/platform.js'

/**
 * The network gate.
 *
 * `network.enabled: false` starts no proxy, lets every request through,
 * and applies no network restriction. The filesystem rules are the same
 * as with the gate on.
 *
 * A missing `enabled` is the same as `true`, so the control rows leave
 * it out.
 */

const POSIX = isLinux || isMacOS

describe('network.enabled schema', () => {
  const base = { allowedDomains: [], deniedDomains: [] }

  it('keeps false and true', () => {
    const off = NetworkConfigSchema.parse({ enabled: false, ...base })
    const on = NetworkConfigSchema.parse({ enabled: true, ...base })
    expect(off.enabled).toBe(false)
    expect(on.enabled).toBe(true)
  })

  it('leaves an absent value undefined, which the manager reads as true', () => {
    const parsed = NetworkConfigSchema.parse(base)
    expect(parsed.enabled).toBeUndefined()
  })

  it('validates the full runtime config with the gate off', () => {
    const parsed = SandboxRuntimeConfigSchema.parse({
      network: { enabled: false, ...base },
      filesystem: { denyRead: [], allowWrite: [process.cwd()], denyWrite: [] },
    })
    expect(parsed.network.enabled).toBe(false)
  })
})

describe.if(POSIX)('network gate on Linux and macOS', () => {
  let root: string
  let workDir: string
  let secretDir: string
  let secretFile: string
  const secret = 'gate-secret'
  let server: Server
  let port: number

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'srt-network-gate-'))
    workDir = join(root, 'work')
    secretDir = join(root, 'secret')
    secretFile = join(secretDir, 'gate-secret.txt')
    mkdirSync(workDir, { recursive: true })
    mkdirSync(secretDir, { recursive: true })
    writeFileSync(secretFile, secret)
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('gate-ok')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await SandboxManager.reset()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(root, { recursive: true, force: true })
  })

  const config = (enabled: boolean | undefined): SandboxRuntimeConfig => ({
    network: {
      ...(enabled === undefined ? {} : { enabled }),
      allowedDomains: [],
      deniedDomains: [],
    },
    filesystem: {
      denyRead: [secretDir],
      allowWrite: [workDir],
      denyWrite: [],
    },
  })

  // `--resolve` keeps the request off the network: the hostname is
  // example.com, but the connection goes to the local server. With the
  // gate on, NO_PROXY does not match example.com, so curl asks the proxy
  // and the empty allowlist refuses it.
  const probeCommand = (): string =>
    `curl -fsS --max-time 10 --resolve example.com:${port}:127.0.0.1 http://example.com:${port}/`

  /** The parent's proxy settings must not decide the result. */
  const env = (): NodeJS.ProcessEnv => {
    const next = { ...process.env }
    for (const key of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
      'NO_PROXY',
      'no_proxy',
    ]) {
      delete next[key]
    }
    return next
  }

  /**
   * The target server and the proxy both live in this process, so the
   * run has to yield the event loop: spawnSync would block the very
   * server the command waits on. The timeout is a guard, not the
   * assertion - every command here finishes well inside it.
   */
  const run = (
    command: string,
  ): Promise<{
    status: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
  }> =>
    new Promise(resolve => {
      const child = spawn(command, {
        shell: true,
        env: env(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      const timer = setTimeout(() => child.kill('SIGKILL'), 20_000)
      child.on('close', (status, signal) => {
        clearTimeout(timer)
        resolve({ status, signal, stdout, stderr })
      })
    })

  it('starts no proxy and lets an unlisted host through when disabled', async () => {
    await SandboxManager.reset()
    await SandboxManager.initialize(config(false))

    expect(SandboxManager.getProxyPort()).toBeUndefined()
    expect(SandboxManager.getSocksProxyPort()).toBeUndefined()
    expect(SandboxManager.getNetworkRestrictionConfig()).toEqual({})

    const wrapped = await SandboxManager.wrapWithSandbox(probeCommand())
    const result = await run(wrapped)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('gate-ok')
  })

  it('restricts the same host when enabled is absent (control)', async () => {
    await SandboxManager.reset()
    await SandboxManager.initialize(config(undefined))

    expect(SandboxManager.getProxyPort()).toBeDefined()
    expect(SandboxManager.getNetworkRestrictionConfig().allowedHosts).toEqual(
      [],
    )

    const wrapped = await SandboxManager.wrapWithSandbox(probeCommand())
    expect((await run(wrapped)).status).not.toBe(0)
  })

  it('keeps the filesystem rules with the gate off', async () => {
    await SandboxManager.reset()
    await SandboxManager.initialize(config(false))

    const wrapped = await SandboxManager.wrapWithSandbox(`cat ${secretFile}`)
    const result = await run(wrapped)
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain(secret)
  })
})

describe.if(isWindows)('network gate on Windows (mxc)', () => {
  let root: string
  let workDir: string
  let secretDir: string
  let secretFile: string
  const requests: MxcRequest[] = []

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'srt-network-gate-'))
    workDir = join(root, 'work')
    secretDir = join(root, 'secret')
    secretFile = join(secretDir, 'gate-secret.txt')
    mkdirSync(workDir, { recursive: true })
    mkdirSync(secretDir, { recursive: true })
    writeFileSync(secretFile, 'gate-secret')
  })

  afterAll(async () => {
    await SandboxManager.reset()
    rmSync(root, { recursive: true, force: true })
  })

  const probe = (): MxcProbeOutput => ({
    tier: 'base-container',
    warnings: [],
    probes: {
      baseContainerSupportsDenyPaths: true,
      baseContainerSupportsIngressHostLoopbackAllow: true,
      baseContainerSupportsIdentitylessLoopbackProxy: true,
      uiCapabilities: {
        canBlockClipboardRead: true,
        canBlockClipboardWrite: true,
        canBlockInputInjection: true,
      },
    },
  })

  const handle = (): MxcProcessHandle => ({
    id: 1,
    standardInput: null,
    standardOutput: null,
    standardError: null,
    wait: async () => ({ exitCode: 0, timedOut: false }),
    kill: () => {},
    dispose: () => {},
  })

  const sdk: MxcSdk = {
    probe,
    spawn: async request => {
      requests.push(request)
      return handle()
    },
  }

  const config = (enabled: boolean | undefined): SandboxRuntimeConfig => ({
    network: {
      ...(enabled === undefined ? {} : { enabled }),
      allowedDomains: [],
      deniedDomains: [],
    },
    filesystem: {
      denyRead: [secretDir],
      allowWrite: [workDir],
      denyWrite: [],
    },
    windows: { backend: 'mxc' },
  })

  const initialize = (enabled: boolean | undefined): Promise<void> =>
    SandboxManager.initialize(config(enabled), undefined, false, {
      windowsMxcSdk: sdk,
    })

  it('passes no proxy and keeps the filesystem denies when disabled', async () => {
    requests.length = 0
    await SandboxManager.reset()
    await initialize(false)

    expect(SandboxManager.getProxyPort()).toBeUndefined()
    expect(SandboxManager.getSocksProxyPort()).toBeUndefined()
    expect(SandboxManager.getNetworkRestrictionConfig()).toEqual({})

    const process = await SandboxManager.spawnSandboxed!('exit 0')
    await process.wait()

    const request = requests.at(-1)
    expect(request?.network.egress.default).toBe('allow')
    expect(request?.network.runtimeConfig).toBeUndefined()
    expect(
      request?.filesystem.deniedPaths.some(p =>
        p.toLowerCase().includes('gate-secret'),
      ),
    ).toBe(true)
  })

  it('passes the proxy when enabled is absent (control)', async () => {
    requests.length = 0
    await SandboxManager.reset()
    await initialize(undefined)

    expect(SandboxManager.getProxyPort()).toBeDefined()

    const process = await SandboxManager.spawnSandboxed!('exit 0')
    await process.wait()

    const request = requests.at(-1)
    expect(request?.network.egress.default).toBe('deny')
    expect(request?.network.runtimeConfig?.networkProxy).toContain('127.0.0.1')
  })
})
