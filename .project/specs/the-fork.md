---
title: The fork's changes over upstream
covers:
  - src/sandbox/sandbox-config.ts
  - src/sandbox/sandbox-manager.ts
  - src/sandbox/mxc-sandbox-utils.ts
  - src/sandbox/windows-sandbox-utils.ts
  - package.json
  - NOTICE
refs:
  - https://github.com/anthropics/sandbox-runtime - the upstream, Apache-2.0
  - https://github.com/anthropics/sandbox-runtime/pull/246 - the `network.enabled` gate that VS Code's build carries, read for its behaviour only
  - "[code://src/sandbox/sandbox-config.ts#L678](../../src/sandbox/sandbox-config.ts#L678) - `network.enabled` in the schema"
  - "[code://src/sandbox/sandbox-manager.ts#L1941-L1949](../../src/sandbox/sandbox-manager.ts#L1941-L1949) - `isNetworkDisabled`, the one reading of the gate"
  - "[code://src/sandbox/mxc-sandbox-utils.ts#L451-L455](../../src/sandbox/mxc-sandbox-utils.ts#L451-L455) - the gate in an MXC request"
  - "[code://src/sandbox/windows-sandbox-utils.ts#L1365-L1367](../../src/sandbox/windows-sandbox-utils.ts#L1365-L1367) - the gate picks the srt-win account"
  - "[code://test/sandbox/network-gate.test.ts](../../test/sandbox/network-gate.test.ts) - the gate's tests"
---

`@ahpio/sandbox-runtime` is upstream's runtime with two changes, as `NOTICE` says. The first is the `network.enabled` setting, with a default of true. When it is false, the runtime starts no proxy, allows every network request, and applies no network restriction. Every filesystem rule still applies. The second is the zod range `^3.25.0 || ^4.6.6`, since only zod 4.6.6 has the advisory's fix. [UPSTREAM.md](../../UPSTREAM.md) says how an upstream release comes into the fork.

## Scenarios

### The gate is on

WHEN `network.enabled` is true or not set
THEN the runtime behaves as upstream does
AND only the domains in `allowedDomains` are reachable, through the proxy.

### The gate is off

WHEN `network.enabled` is false
THEN no proxy starts, even when `allowedDomains` is set
AND every host is reachable
AND every filesystem rule applies.

### The gate on each platform

WHEN `network.enabled` is false
THEN macOS and Linux wrap the command with no network restriction
AND srt-win runs the command as `srt-sandbox-open`, an account with no network filters
AND an MXC request has egress `allow` and no proxy.

## Known gaps

- MXC and its gate code are a week old upstream and in the fork, and are tested only by the fork's suite and CI.
