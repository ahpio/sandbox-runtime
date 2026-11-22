# Keeping up with upstream

`@ahpio/sandbox-runtime` is a fork of [anthropics/sandbox-runtime](https://github.com/anthropics/sandbox-runtime). It takes each upstream release and keeps its own changes on top. What the fork adds is in [.project/specs/the-fork.md](.project/specs/the-fork.md).

A pass merges one upstream release into the `ahpio` branch and releases it. Passes are made by hand for now. Each pass is logged here, newest first, so the next one starts from a known upstream tag.

## How a pass is made

1. Find the newest upstream tag: `git ls-remote --tags https://github.com/anthropics/sandbox-runtime | grep -v '\^{}' | sort -t/ -k3 -V | tail -1`.
2. Stop if it is the tag of the last pass.
3. Fetch it: `git fetch https://github.com/anthropics/sandbox-runtime tag <tag>`.
4. Make a branch `upstream/<tag>` from `origin/ahpio`, and run `git merge <tag>`.
5. In `package.json`, keep the name `@ahpio/sandbox-runtime` and the zod range, and set the version to `<upstream version>-rc.0`. Run `npm install --package-lock-only`.
6. In `NOTICE`, set the upstream version in its last line.
7. Read the upstream diff for new code that starts a proxy, filters a request or wraps a command. Each new path reads the gate, as the spec says.
8. Run `bun test`, with `test/sandbox/network-gate.test.ts` and `test/sandbox/mxc-config.test.ts`.
9. Open a pull request into `ahpio`. CI runs the integration tests and `release.yml` without the publish, on Linux, macOS and Windows.
10. Merge on Softov's word, and log the pass here.
11. Publish a GitHub release `v<version>-rc.0`, marked as a prerelease. `release.yml` publishes it to npm under `next`.
12. Run ahpd's computer suite against the release candidate. Then release `v<version>` the same way, under `latest`.

## Versions

- A release carries upstream's number: upstream `0.0.84` ships as `0.0.84-rc.0`, then `0.0.84`.
- A fork-only fix between two upstream releases ships as `<version>-ahpio.<n>`, such as `0.0.84-ahpio.1`. Its hyphen puts it under npm's `next`, and ahpd pins the exact version.
- A version with a hyphen goes to `next` and one without goes to `latest`, as `release.yml` decides from the tag.

## Pass 1 - 2026-11-22, upstream v0.0.83

- Upstream `v0.0.83` at `0bbebed0aa9a`, which is also upstream `main` on 2026-11-22.
- The fork's changes merged in PR #1 as `5ec7d8a`.
- `0.0.83-rc.0` is built and verified by CI run 44989520168. Its first npm publish waits for Softov, since npm asks for his one-time password.
