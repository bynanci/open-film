# Automatic macOS Cross-Process Dead-Owner Detection — Validation

Date: 2026-10-31.
Capability: Automatic Windows and macOS cross-process dead-owner recovery with verified OS-specific process identity and liveness evidence.

## Key Invariants and Contracts

1. **Darwin Local PID Scope & Boot Identity**:
   - Queries the trusted system binary `/usr/sbin/sysctl -n kern.bootsessionuuid` to acquire the kernel's unique boot session identifier.
   - Enforces strict UUID syntax validation (`^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$`) and explicitly rejects null or zeroed UUIDs (`00000000-0000-0000-0000-000000000000`).
   - Execution is bounded with explicit timeouts (5000ms), buffer limits (4096 bytes), and clean stdio handling.

2. **Cryptographic Privacy & Portability Invariant**:
   - Portable project files never store raw `MachineGuid` (Windows) or `bootsessionuuid` (Darwin).
   - Only a cryptographic SHA-256 digest is persisted: `SHA-256(JSON.stringify([platform, hostname, bootSessionUuid.toLowerCase()]))`.

3. **Liveness Verification & Dead-Owner Reclamation**:
   - Process liveness is checked via `process.kill(pid, 0)` only when the owner host matches the verified local scope.
   - ESRCH confirms that the process no longer exists on the local machine within the current boot session, safely marking the execution owner as `"dead"` for automatic recovery and job re-queuing.
   - Reused PIDs across reboots or foreign hosts are strictly treated as `"unknown"`, preventing accidental reclamation of active or foreign workloads.

4. **Cold Scope Revalidation**:
   - Permits a bounded, single revalidation attempt if module-startup latency prevented initial verification on Windows or Darwin, without orphaning locally queued execution tokens.

5. **Fail-Closed on Unverified Platforms**:
   - Unsupported platforms (e.g., `freebsd`, `aix`) or malformed/unavailable evidence safely default to `verifiable: false` with an ephemeral random UUID host, preserving user-confirmed manual recovery without unverified automatic takeover.

## Test Evidence

- `packages/application/tests/review-owner-platform.test.ts` (22/22 passed):
  - Windows OS evidence sharing and trusted PSModulePath sanitization.
  - Darwin OS evidence sharing without disclosing raw boot UUID.
  - Darwin dead-owner detection via ESRCH probing.
  - Darwin foreign boot session rejection.
  - Darwin malformed and unavailable evidence fail-closed handling.
  - Revalidation without losing queued owners.
  - Unverified platform isolation.
- Contract test suite: 74 files, 1445 tests passed (`pnpm test:contracts`).
- Type check: `pnpm typecheck` (passed).
- Lint: `pnpm lint` (passed with 0 warnings).
- Formatting: `pnpm format:check` (passed).
- Docs i18n mirrors: `pnpm test:docs-i18n` (passed).
