# Release 0.8.1 — sharp 0.35.5 security fix + clean source archive

Goal: prepare, but do not publish, release 0.8.1. It ships the sharp 0.35.5
security bump already merged in `main`, with a source archive that no longer
leaks internal development records.

Authorized by the user on 2026-10-09: release preparation without publishing
(tag, push, GitHub release and PR each need a separate explicit order), and
"exclude odd/ from the source ZIP" for the privacy defect.

Status: prepared and verified. Nothing tagged, pushed or published.

## Entry condition satisfied

The user reported the physical D200 tests as positive for the locally installed
0.8.0 + sharp 0.35.5 build, exercising all four areas: real image rotation, at
least one SVG (the path `CVE-2026-96889` affected), clock/system panels, and
Setup Large Display. That lifts the release hold the user had set.

Traceability: the accepted build was byte-for-byte identical to the ZIP built at
that time (189/189 files, 0 differences), sha256
`b300406a51989243b7bbbe29905cec8e5adc4112bb2a644935bdef3ff04a92c6`, matching its
`SHA256SUMS.txt` entry. The acceptance therefore applies to the packaged
artifact, not to an approximate copy.

## Residual risk handed to the user

The 0.8.1 version bump is not purely cosmetic: the version string is also the
Setup request version (`plugin/setup.js` `PLUGIN_VERSION`,
`helper/Invoke-ImageSlideSetup.ps1` `$PluginVersion`,
`helper/Invoke-ImageSlideSetup.mjs` `VERSION`) and the profile metadata version.
The physical Setup acceptance ran on the `0.8.0` string. The Node suite covers
the cross-version request handling, and `test/setup.test.js` still exercises a
`0.7.4` request against the current version, but the on-device Setup evidence for
the `0.8.1` string does not exist until 0.8.1 is exercised on the D200.

## Tasks

### R1 — Track the work  ✅

Feature document, Engram mirror and visible todo created before the first source
write.

### R2 — Keep internal records out of the source archive  ✅

`odd` joined `SOURCE_EXCLUDED_PARTS` in `tools/build_release.py`, so
`source_files()` no longer packages the internal ODD records into the public
`ImageSlidePlugin-source.zip`. That set matches on path parts, so it also covers
`odd/exports/**`.

Two assertions cover it: a unit-level test that calls `builder.source_files()`
and rejects any `odd/` arcname (observable without rebuilding, so it carries the
real RED/GREEN evidence), and a member assertion on the built archive inside
`test_packages_and_checksum_manifest_read_back`.

### R3 — Bump the plugin to 0.8.1  ✅

Bumped in `package.json`, `package-lock.json`, `manifest.json`,
`plugin/setup.js`, both helper files, `Install-ImageSlidePlugin.ps1`
(`$ExpectedPluginVersion`), `tools/profile_tool.py`, `README.md`, a new
`MIGRATION.md` section, and the delivered profile through
`profile_tool.py set-version`.

The version literals in the tests were removed instead of bumped:
`tests/test_delivery.py`, `test/slideshow.test.js` and `test/setup.test.js` now
derive the expected version from the plugin `package.json`. `setup.test.js`
needed one derivation beyond the obvious ones because `setup.js` fails closed
when a request's `pluginVersion` differs from `PLUGIN_VERSION`.

### R4 — Source gate  ✅

`npm test` and `IMAGESLIDE_SKIP_ARTIFACT_TESTS=1 python -m unittest discover -s tests`.

### R5 — Rebuild the artifacts  ✅

Full `python tools/build_release.py`, then every `SHA256SUMS.txt` entry recomputed
independently and the source archive inspected for `odd/` members.

### R6 — Full gate including artifact tests  ✅

`python -m unittest discover -s tests`, now green including the privacy scan that
was failing.

### R7 — Runtime check on the built artifact  ✅

The built plugin ZIP extracted to a temporary directory and exercised through
Studio's own Node, so the check runs against the shipped archive rather than the
source tree.

### R8 — Refresh `TEST-REPORT.txt` from observed runs  ✅

Re-run, not hand-edited: header, both Python suite counts, runtime inventory,
privacy paragraph and physical validation section updated, plus two new work
units for the security bump and the source archive fix. Because
`TEST-REPORT.txt` is a delivery file and is also packaged inside the source
archive, refreshing it required one more rebuild, which is why the report and the
regenerated archives land in the same commit.

### R9 — Commits on the feature branch  ✅

See the commit list below.

### R10 — Report and stop  ✅

Candidate reported; tag, push, GitHub release and PR remain the user's explicit
decisions.

## Evidence

- R2 RED: a probe over `builder.source_files()` counted 12 `odd/` arcnames
  before the fix (5 under `odd/exports/opencode-profiles`, 7 under `odd/tasks`,
  including `odd/tasks/build-release-npm-launcher.md`, the document carrying the
  private path). After the fix: 0.
- R2 GREEN in the artifact: the rebuilt source archive has 0 of 90 members under
  `odd/`.
- R4: `npm test` -> 59 tests, 59 pass, 0 fail, exit 0.
  `IMAGESLIDE_SKIP_ARTIFACT_TESTS=1 python -m unittest discover -s tests` ->
  Ran 34 tests, OK, skipped 3, exit 0.
- R5: full build exit 0; 12/12 `SHA256SUMS.txt` entries recomputed and matching;
  the plugin archive declares version 0.8.1 and pins sharp 0.35.5 with 189 files.
- R6: `python -m unittest discover -s tests` -> Ran 34 tests, OK, skipped 2,
  exit 0. The 2 skips are the optional production-shape Windows profile fixture
  tests (`test_profile_clone_uses_only_new_identity_and_preserves_device`,
  `test_production_shape_patch_restore_round_trip_is_byte_exact`).
- R7: Studio Node v20.12.2 against the extracted archive reported
  `sharp 0.35.5, vips 8.18.7` and decoded/cover-resized an SVG to a 458x196 PNG
  (4,726 bytes), exit 0.
- R8: the refreshed report is inside the rebuilt source archive byte-identically.
- Profile: `profile_id`, `package_id` and `action_id` unchanged; profile sha256
  `81f0a253fe7f4c8bf46e0b12c4c6c4ea61a802972d23c569923811da248ec469`, equal to the
  receipt's `output_sha256`.
- Independent verification by a separate read-only session confirmed 8 of 9
  claims. The one it refuted was correct to refute and is not a defect: `0.35.4`
  and `8.18.6` do appear inside the delivered `TEST-REPORT.txt`, as the two
  intentional historical statements (the "moved from 0.35.4 to 0.35.5" sentence
  and the carried-over macOS harness evidence). They are not native files and do
  not trip the privacy scan.
- `verify_delivery_privacy` over the delivered files plus `SHA256SUMS.txt` raised
  no exception.

## Commits on this branch

- `6038b81` `fix(release): keep internal odd/ records out of the source archive`
- `c98a1bb` `build(release): bump the plugin to 0.8.1`
- `64b2ad8` `docs(release): refresh TEST-REPORT.txt for 0.8.1 and regenerate the artifacts`
- The `docs(odd)` commit carrying this document closes the feature.

Artifact hashes for this candidate:

```text
com.arkamax.ulanzi.imageslide.ulanziPlugin.zip 7c299717516cfaed54490670dcb79f44689a209b1ad8cccc16021df00b3ea8a1
ImageSlidePlugin-source.zip                   1c3933fe0b761f397bdd248d416f1ff37e580e6ef033a7d01f5c031a4b6b46c9
```

## What is deliberately not done here

- No git tag, no push, no GitHub release, no pull request.
- The locally installed plugin remains the accepted 0.8.0 + sharp 0.35.5 build.
  Installing 0.8.1 locally is a separate decision, and doing it would be what
  closes the residual Setup-version gap.
