# Vite advisory remediation — 2026-10-20

Base: `249a57bb3fce50c3437fc3a6d29906d8c2374c61`.
This is a bounded dependency correction for integration PR #41. The baseline
JavaScript advisory job failed in [run 39493342846](https://github.com/bynanci/open-film/actions/runs/39493342846/job/118871917360).

## Confirmed issue and change

The actual baseline `pnpm audit --json` exits 1 with
[GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv),
a moderate CWE-78 advisory affecting Vite `8.2.0` through `8.2.3`.
Its four dependency paths share the same Vite instance: root, Vue plugin,
Vitest and Vitest's mocker. The advisory describes Windows editor launching
with a specially named file and attacker-controlled environment content or
NTFS alternate data streams. This is not evidence of an OpenFilm production
exploit or Linux shell execution.

Pin only Vite to exact `8.2.4`, the patched version on the existing minor line.
The lock updates its integrity, peer instances and the published optional
`@vitejs/devtools` peer range. All 290 non-Vite package records and all other
versions/integrities remain unchanged, including PostCSS `8.5.28`, Rolldown
`1.2.12`, Vue, Vitest and the native packages. Koffi stays pinned to `3.3.3`
with its lifecycle build disabled. No advisory suppression, application API,
server Origin/Host/session policy, project schema or first-party version changes.

## Upstream and artifact review

The official [Vite changelog](https://github.com/vitejs/vite/blob/v8.2.4/packages/vite/CHANGELOG.md)
and [launch-editor patch](https://github.com/vitejs/launch-editor/commit/3c2f9bf2ff8fe63d056a8f9cc52d825b66ca79fc)
were reviewed against the published bundles. The installed bundle changes
launch-editor `2.14.1` to `2.14.2`, rejects percent signs and line breaks before
the Windows child-process boundary, reports the rejection through its callback,
and preserves ordinary quoted/escaped paths. The advisory's first patched
version controls admission; a changelog entry alone does not qualify `8.2.3`.

Vite's Node engine remains `^20.19.0 || >=22.12.0`; the pinned Node 24 line,
Vue plugin `6.0.6` and Vitest `5.0.3` satisfy their published engine/peer ranges.
The intermediate patch changes cover dev module/HMR handling, CSS/config
fixes, random-port selection and filesystem-serving checks. This project uses
the existing Vue plugin, build and dev-server APIs; no configuration migration
was required. Production build, actual dev compilation and Vitest controls
below exercise those boundaries.

Downloaded the official registry tarballs without executing package scripts.
The `8.2.4` tarball SHA-512 matches the lock and registry metadata:

```text
sha512-lfauXnrf2x0p+UoA+wXh0dgFWnUjCyG6Js95KBkgaCwUU9k0DAHI4W6Q0WCx+h+5g+Alce1y4Zi2QjjK0UvGBw==
```

Its archive SHA-256 is
`1d132a84f4980b2cbb15e1c1c78728aed90f5eb81c70791ed0cf133a1211139a`.
Registry SHA-1 and both ECDSA registry signatures also verify with the published
npm signing key. Sigstore 4.1.0 verifies the provenance bundle using TUF trust,
the GitHub Actions certificate issuer and the exact identity
`https://github.com/vitejs/vite/.github/workflows/publish.yml@refs/tags/v8.2.4`.
Its subject digest matches the tarball and identifies source commit
`eb3137d38934b557a410c85e54f10682a944440b`. No trust verification was disabled.
All 36 installed package files match the independently verified archive.

## Bounded validation

The permanent `vite-editor-security.test.ts` executes the installed bundle's
actual launch-editor modules with an inert child-process boundary and a modeled
Windows platform. Replaying the integrity-verified `8.2.0` bundle gives five
failures for unsafe percent/CR/LF inputs and passes the ordinary-path control.
The identical six assertions pass against installed `8.2.4`. No Windows process,
shell, environment-variable expansion or NTFS behavior was executed or qualified.

| Check                                                       | Result                                                                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen install, followed by frozen offline repeat           | Passed; Koffi build remains disabled.                                                                                                                 |
| `pnpm audit --json`                                         | Passed, exit 0; zero vulnerabilities at every severity.                                                                                               |
| Full TypeScript/Vue and ESLint                              | Passed.                                                                                                                                               |
| Production build                                            | Passed with Vite `8.2.4`, 240 modules; existing large-chunk warning retained.                                                                         |
| Six focused Vitest files                                    | 67 passed in 2.56s: dependency regressions, actual build/native-loader controls, RuntimeGate/App draft lifecycle and real/unit exclusive publication. |
| Built CLI smoke                                             | Passed: real import, analysis, render, CJK title raster, exports and reopen; originals unchanged.                                                     |
| Actual Chromium with Vite dev server and real local service | Passed: Vue compilation, decoded synthetic video thumbnail, favorite edit and persistence across reload; no page errors or external requests.         |

The browser probe uses ephemeral Vite/API ports. Its test-only proxy forwards
the already permitted fixed desktop Origin because production intentionally
does not admit arbitrary development ports. A direct attacker-Origin control
still returns 403; production policy is unchanged. No default-port service
or full repository/browser suite was run for this correction.

Evidence is retained under `/tmp/openfilm-v1-validation/pr41-vite-security-*`,
including the failed baseline audit, upstream authentication receipt, RED/GREEN
launcher results, semantic lock scope, final audit and actual browser receipt.
The coordinator owns fresh combined gates, the complete browser run and hosted
exact-head CI before merge/release. Windows/macOS workstation and native-installer
distribution gates retain their prior unverified status; a zero npm audit does
not resolve the separate Rust GLib distribution warning.
