# build_release.py cannot spawn npm on Windows

Goal: make `tools/build_release.py` able to invoke npm on Windows, so the release
bundle can actually be rebuilt on this machine. Without it, no release can ship
any dependency fix, including the sharp 0.35.5 security bump.

## Defect

`fetch_missing_archive()` calls:

```python
subprocess.run(["npm", "pack", f"{name}@{version}", "--pack-destination", str(cache)], ...)
```

On Windows, `CreateProcess` searches PATH and appends only `.exe`. npm is not an
executable there; it is `npm.cmd`. The bare name therefore fails:

```
FileNotFoundError: [WinError 2] El sistema no puede encontrar el archivo especificado
```

while the shim is perfectly present and discoverable:

```
shutil.which("npm") -> C:\Program Files\nodejs\npm.CMD
subprocess.run(["npm",     "--version"]) -> FileNotFoundError
subprocess.run(["npm.cmd", "--version"]) -> 10.8.0
```

Reproduced on Python 3.14.4 and 3.11.6, so it is not a Python-version regression.

## Why this is an inconsistency, not a new pattern

The repository already resolves external commands correctly elsewhere:
`tests/test_delivery.py` uses `POWERSHELL = shutil.which("powershell.exe")`.
`build_release.py` already imports `shutil`. Only the npm call site uses a bare
name.

Note that `build_artifacts()` invokes `sys.executable` for `profile_tool.py`, which
is already a resolved absolute path and needs no change. This is the only defect.

## Locked decisions

1. Resolve the launcher with `shutil.which("npm")` and fail with a clear message
   when npm is genuinely absent, rather than letting a `FileNotFoundError` surface
   from deep inside `subprocess`.
2. Do not add a `shell=True` workaround. Passing an explicit resolved launcher is
   the portable fix and keeps the process arguments unquoted and non-injected.
3. The regression guard goes in a new focused file `tests/test_release_builder.py`
   rather than alongside its sibling in `tests/test_delivery.py`. Reason: that file
   carries 237 pre-existing blocking findings (about 220 `E702` semicolons, 4
   `E701`, 3 `E731` and 9 `spec_from_file_location` None-narrowing findings, in a
   43 KB file with 122 lines containing `;`). Adding to it drags that unrelated
   debt into every gate run for this change and inflates the review surface for a
   two-line fix. Consolidating the builder tests into one file is a separate
   maintainer decision, recorded as an open question.
4. No push, no PR, no merge.

## Invariants that must not regress

- `fetch_missing_archive` keeps its signature and its `cwd=PLUGIN`,
  `capture_output=True`, `text=True` behaviour.
- The npm argv stays `["pack", "<name>@<version>", "--pack-destination", "<cache>"]`,
  with the launcher as `argv[0]`.
- `python tools/build_release.py --stage-only` keeps passing `verify_stage()`.
- The existing `test_release_builder_pins_only_the_three_runtime_targets`
  assertions stay intact.

## Tasks

### N1 — Red test

Add `tests/test_release_builder.py` with
`test_fetch_missing_archive_invokes_npm_through_its_resolved_launcher`. It stubs
`subprocess.run` to capture argv and raise before anything is executed, so it needs
no network, then asserts `argv[0] == shutil.which("npm")`. Pre-fix this must fail
with `'npm' != '<resolved path>'`.

### N2 — Fix

`fetch_missing_archive` uses the resolved launcher and raises a clear
`RuntimeError` when npm cannot be found.

### N3 — End-to-end verification

Delete the tarballs that were cached to work around this defect (the `0.35.5` and
`1.3.4` ones, previously fetched by hand with `npm.cmd`) and run
`python tools/build_release.py --stage-only` with no cache pre-population. The
script must now fetch them itself through subprocess and still pass
`verify_stage()`. Also re-run the full Python suite and the plugin suite.

### N4 — Commit

One Conventional Commit on `fix/build-release-npm-launcher`, recording the
verification evidence in this document.

## Evidence

### N1 — Red test

`tests/test_release_builder.py`,
`test_fetch_missing_archive_invokes_npm_through_its_resolved_launcher`. It stubs
`builder.subprocess.run` to capture argv and raise `_StopBeforeSpawn`, so the real
npm never runs and no network is needed. Against the pre-fix code:

```
E       AssertionError: 'npm' != 'C:\\Program Files\\nodejs\\npm.CMD'
E       - npm
E       + C:\Program Files\nodejs\npm.CMD
E        : npm must be spawned through its resolved launcher path
1 failed
```

Independently re-derived by the verifier subagent with a `git stash push` round
trip on `tools/build_release.py` alone, then restored.

### N2 — Fix

`npm_launcher()` added; `fetch_missing_archive` now passes it as `argv[0]`. Direct
reproduction of both sides of the defect:

```
subprocess.run(["npm", "--version"])     -> FileNotFoundError: [WinError 2]
shutil.which("npm")                      -> C:\Program Files\nodejs\npm.CMD
subprocess.run([that, "--version"])      -> 10.8.0
```

No `shell=True` anywhere in the diff (verified).

### N3 — End-to-end verification

The six tarballs that had been fetched by hand with `npm.cmd` as a workaround were
deleted from `.build-package/cache`, leaving only the stale 0.35.4 / 1.3.3 entries.
Then:

```
python tools/build_release.py --stage-only
Verified universal stage: D:\Desarrollo\SlideImgPlugin\.build-package\stage\com.arkamax.ulanzi.imageslide.ulanziPlugin
EXIT=0   (real 0m8.334s)
```

The script fetched all six tarballs itself through `subprocess`, and
`fetch_packages()` validated each one against the lock's `integrity` hash. The
cache afterwards contains all six, and the staged bundle reports `sharp` 0.35.5 and
`@img/sharp-libvips-darwin-x64` 1.3.4.

This is the check that matters: it exercises the repaired code path rather than the
unit test's stub.

### N4 — Checks

```
python -m pytest tests/test_release_builder.py -q   -> 1 passed
python -m pytest tests/ -q                          -> 31 passed, 2 skipped
python tools/build_release.py --stage-only          -> exit 0, Verified universal stage
```

The two skips are the Windows profile fixture tests that require
`IMAGESLIDE_WINDOWS_PROFILE_FIXTURE` and `IMAGESLIDE_WINDOWS_PROFILE_ID`.

## Open question left for the maintainer

`tests/test_delivery.py` carries 237 pre-existing blocking analyzer findings that
are unrelated to this change: roughly 220 `E702` (multiple statements on one line,
semicolon), 4 `E701` (colon), 3 `E731` (lambda assignment) and 9
`spec_from_file_location` None-narrowing findings, spread over a 43 KB file with
122 lines containing `;`. This repository's plugin JavaScript uses the same dense
one-liner style deliberately, so those findings look like a linter disagreeing
with an intentional house style rather than defects.

Clearing them means reformatting about 122 lines of that file. That is an
oversized, unrelated change, so it was deliberately NOT done here and is left to
the maintainer to accept or reject. The new regression test was therefore placed
in its own file so this change's gate stays clean.
