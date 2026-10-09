# Local installation of the 0.8.0 + sharp 0.35.5 package (D200 pre-test)

Goal: install on this machine the plugin package built from `main`
(0.8.0 + the sharp 0.35.5 security bump) so the user can run the physical
D200 test that gates the release, and clear the blockers that prevented that
installation.

Authorized by the user on 2026-10-09 ("si", after the interrupted
"publica en local el plugin" of the previous session).

Branch: `fix/stale-sharp-pins-local-install`, created from `main` (efa3783).

## State carried in from the interrupted session

The previous session was cut off at 2026-10-09 23:08:17 while launching the
build task. What it left behind, verified read-only:

- `python tools/build_release.py` (full run, not `--stage-only`) regenerated
  `com.arkamax.ulanzi.imageslide.ulanziPlugin.zip` (28,438,579 bytes,
  sha256 `b300406a51989243b7bbbe29905cec8e5adc4112bb2a644935bdef3ff04a92c6`),
  `ImageSlidePlugin-source.zip` (sha256
  `1ea52685022fc786b1ce429377d25c1710ad73944b01fef0fcb247d0b06e15ee`) and the
  two matching `SHA256SUMS.txt` lines. The new ZIP contains `sharp` 0.35.5 and
  `@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.5.node`.
- Nothing was installed. The active plugin was still 0.8.0 with sharp **0.35.4**.
- Version stays 0.8.0; no tag, no push. Release hold still in force: no release
  until the user passes the physical D200 test.

## Blocker 1 — stale sharp pins (third occurrence of one defect class)

`sharp`'s version was still restated as a literal in three places the 0.35.5
bump did not update:

| File | Line | Stale value | Consequence |
| --- | --- | --- | --- |
| `Install-ImageSlidePlugin.ps1` | 125 | `sharp-win32-x64-0.35.4.node` in `Assert-PluginContent` | The installer threw `Missing essential plugin file` and refused to install the fixed package |
| `tests/test_delivery.py` | 568 | `sharp-*-0.35.4.node` and `libvips-cpp.8.18.6.dylib` | The delivery suite failed against the rebuilt ZIP |
| `README.md` | 171 | "stages Sharp 0.35.4" | Wrong documentation |

The same class already appeared in `build_release.RUNTIME_PACKAGES` (fixed by
deriving the assertion from the lock, see
`odd/tasks/sharp-0.35.5-cve-2026-96889.md`). The fix removes the literals
instead of bumping them.

Two independent version series had to be respected, verified by reading the
archive rather than assuming:

```text
node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.5.node
node_modules/@img/sharp-darwin-x64/lib/sharp-darwin-x64-0.35.5.node
node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64-0.35.5.node
node_modules/@img/sharp-libvips-darwin-x64/lib/libvips-cpp.8.18.7.dylib
node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.7.dylib
```

The `.node` filename carries the npm **package** version (0.35.5); the dylib
filename carries the **libvips** version (8.18.7, was 8.18.6).
`RUNTIME_PACKAGES["@img/sharp-libvips-darwin-x64"]` is `1.3.4`, so the dylib name
is discovered from the archive and never derived from the package version.

### T2 — RED observed

`python -m pytest tests/test_delivery.py -q` ->
`1 failed, 29 passed, 2 skipped`, exit code 1:

```text
AssertionError: 'com.arkamax.ulanzi.imageslide.ulanziPlugin/node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.4.node' not found in [...]
```

Observed at `tests/test_delivery.py:569`.

Note on the preflight: `-WhatIf` returns before `Expand-Archive`, so it cannot
catch this defect. It is not a substitute for the suite. That was confirmed
empirically here, because the first preflight attempt failed for an unrelated
reason (blocker 2) while the stale pin was still in place.

### T3 — Fix applied

- `Install-ImageSlidePlugin.ps1`: `Assert-PluginContent` reads the version from
  the staged `node_modules/sharp/package.json` (guarded against a missing value)
  and builds the win32-x64 binding path from it.
- `tests/test_delivery.py`: the three `.node` members are derived from
  `build_release.RUNTIME_PACKAGES`; each darwin libvips package must contain
  exactly one `lib/libvips-cpp.*.dylib` member.
- `README.md:171`: 0.35.4 -> 0.35.5.

### T4 — GREEN observed, with one pre-existing failure

- `npm test` (in `com.arkamax.ulanzi.imageslide.ulanziPlugin`, `node --test`):
  59 tests, 59 pass, 0 fail, exit 0.
- `python -m pytest tests/ -q`: `1 failed, 30 passed, 2 skipped`, exit 1. The
  remaining failure is **not** caused by this change: the delivery privacy scan
  rejects `ImageSlidePlugin-source.zip`, see blocker tree below.
- `python -m ruff check --select E7,Q,I,UP,B tests/test_delivery.py`: all checks
  passed.
- PowerShell parser check on the installer: `PS PARSE OK`.
- The 2 skips are the Windows profile fixture tests that require
  `IMAGESLIDE_WINDOWS_PROFILE_FIXTURE` and `IMAGESLIDE_WINDOWS_PROFILE_ID`,
  absent on this machine.

## Blocker 2 — the installer pinned one Studio install path and version

The preflight failed before reaching the package checks:

```text
FAIL: Ulanzi Studio 3.2.11 executable was not found at C:\Program Files (x86)\UlanziDeck\UlanziDeck.exe
```

Verified causes:

- `C:\Program Files (x86)\UlanziDeck\` exists but is an empty leftover folder.
- Studio is actually installed at
  `C:\Program Files (x86)\Ulanzi Studio\UlanziDeck.exe`, and the registry
  uninstall entry reports **Ulanzi Studio 3.3.9** (`UninstallString`
  `C:\Program Files (x86)\Ulanzi Studio\uninst.exe`), so the `3.2.11` in the
  message was stale too.

### T5 — Fix applied and preflight observed

`Resolve-StudioExecutable` now resolves the executable from the Studio uninstall
registry entry (HKLM 32/64-bit and HKCU) and from the known install folders, and
a new `-StudioExecutable` parameter overrides discovery. The error message no
longer names a fixed version. Registry property access is guarded through
`PSObject.Properties`, because `Set-StrictMode -Version 2.0` throws on a missing
property (the first version of this fix failed exactly there and was corrected).

Preflight observed:

```text
Validated plugin SHA-256: b300406a51989243b7bbbe29905cec8e5adc4112bb2a644935bdef3ff04a92c6
Validated profile SHA-256: cad7c0b87b67ffd26cf676eaebd01273c0d47b37dc23cd0f1ec305a8ab160f35
PASS: preflight validation succeeded. -WhatIf made no filesystem changes and launched nothing.
Planned plugin destination: %APPDATA%\Ulanzi\UlanziDeck\Plugins\com.arkamax.ulanzi.imageslide.ulanziPlugin
```

Re-running the same preflight after the install fails with
`FAIL: Ulanzi Studio is running. Close it manually and run the installer again; no
process was stopped.` That is the intended guard, not a regression: Studio is now
running because this install started it, and the script correctly refuses to
install over a live Studio instead of terminating the process.

### T6 — Install and independent verification

The installer ran with Studio closed and exited 0, reporting `PARTIAL: plugin
installed and Ulanzi Studio started, but no verified .ulanziDeckProfile
association was found.` The missing association only skips the automatic profile
import; Studio was started normally and the exact profile path was printed for
manual import.

Independent verification, performed outside the installer's own checks:

- Byte-for-byte equality between ZIP and destination: 189 ZIP members vs 189
  installed files, 0 missing, 0 extra, 0 SHA-256 mismatches.
- Installed `node_modules/sharp/package.json` -> `0.35.5`.
- Installed `node_modules/@img/sharp-win32-x64/lib/` ->
  `sharp-win32-x64-0.35.5.node`, `libvips-cpp-8.18.7.dll`, `libvips-42.dll`
  (no `0.35.4` binding remains).
- Installed `manifest.json` -> Version `0.8.0`.
- Timestamped backup of the previous install:
  `_arkamax_imageslide_backups\com.arkamax.ulanzi.imageslide.ulanziPlugin-20261009T213156Z-31d61232`,
  holding sharp `0.35.4` with `sharp-win32-x64-0.35.4.node` and
  `libvips-cpp-8.18.6.dll`.
- Studio process running: `UlanziDeck.exe` PID 15372, window title
  "Ulanzi Studio".
- Functional decode through the installed runtime, using Studio's own bundled
  Node (`<studio install>\nodejs\node.exe`, v20.12.2), from the installed plugin
  directory: `sharp 0.35.5, vips 8.18.7`, decoded and cover-resized an SVG to a
  `458x196` PNG (4726 bytes), exit 0. The same check also passed on the system
  Node v24.15.0, so the shipped binding works on both ABIs.

## Commits on this branch

- `0ed57b0` `fix(release): derive the sharp runtime version instead of pinning it`
  — installer sharp derivation, delivery suite, `README.md`.
- `0368516` `fix(installer): discover the Ulanzi Studio executable instead of pinning one path`
  — installer resolution.
- The `docs(odd)` commit that records this document closes the feature.

## Open items handed to the user

1. **Physical D200 test** of the installed 0.8.0 + sharp 0.35.5 build. This is
   the gate that holds the release. The plugin is installed and Studio is
   running; the profile import may need to be confirmed manually as
   "Image Slideshow".
2. **Blocker 3, pre-existing and release-blocking (not install-blocking):**
   `ImageSlidePlugin-source.zip` fails the delivery privacy scan because it
   contains `odd/tasks/build-release-npm-launcher.md`, which holds a literal
   local development path that matches `PRIVACY_MARKERS` in
   `tools/build_release.py`. `verify_delivery_privacy` raises
   `RuntimeError: Private source identity found in delivery artifact`. This came
   from the 2026-10-09 23:08 rebuild picking up the committed task documents; it
   is independent of everything fixed here. It needs a decision: exclude the
   internal `odd/` records from the source archive, or keep the path out of
   them.
3. **`TEST-REPORT.txt` (lines 84, 93)** records sharp 0.35.4 / libvips 8.18.6
   and must be re-run, not rewritten by hand, before any release.
4. **Regenerated release artifacts are intentionally uncommitted** on disk:
   `com.arkamax.ulanzi.imageslide.ulanziPlugin.zip`,
   `ImageSlidePlugin-source.zip`, `SHA256SUMS.txt`. They are artifacts of the
   already-published `v0.8.0` with a different dependency, and the source ZIP is
   additionally privacy-contaminated. Committing and pushing them without a new
   tag would make the published `v0.8.0` assets disagree with the repository.
5. **The installer script has no automated test coverage.** This is how blocker
   2 shipped: nothing in `tests/` reads `Install-ImageSlidePlugin.ps1`. A parser
   or contract test would catch the next stale path or pinned version.
