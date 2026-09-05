# Put an image slideshow on the Ulanzi D200 large display

Created by **Santiago Pérez**.

ImageSlidePlugin keeps Ulanzi Studio and its plugins intact. It installs **Image Slideshow**, imports an independently identified profile clone, and lets you choose an external image folder from the Property Inspector.

Version **0.3.2** automatically center-crops images of other sizes to 458 x 196 in memory while leaving the original files untouched. It also places the complete `*.ulanziPlugin` package at the repository root for Community Store discovery.

An existing successful **0.1.9** Setup patch does not need to be patched again. Select **Restore original** before pressing Setup; 0.2.0 accepts that version's verified `apply-or-repair` receipt and backup, binds them into a new restore request, and restores the exact pre-0.1.9 bytes after Studio closes. Missing, ambiguous, changed, or tampered lineage fails closed.

> Safety boundary: Setup launches a detached assistant that prepares a hashed request while Studio is open. **You still close Studio manually when prompted**; the assistant then applies the verified operation and restarts Studio. The plugin never terminates Studio.

## Quick path

1. Keep your original `Arkamax` export. It remains the rollback authority.
2. Close Ulanzi Studio.
3. Run preflight:
   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-ImageSlidePlugin.ps1 -WhatIf
   ```
4. If preflight prints `PASS`, run the same command without `-WhatIf`.
5. Import `ImageSlide.ulanziDeckProfile` when prompted, or import it manually as **Image Slideshow**.
6. Select the slideshow action, choose a folder in its Property Inspector, and verify the physical D200.

## Choose images

The Property Inspector provides **Select folder**, interval, loop, alphabetical/modified-date order, status, and refresh controls. Settings are plugin-wide because the cloned profile has one large-display slideshow instance.

| Rule | Behavior |
|---|---|
| Size | Exact 458 × 196 files pass through; other sizes up to 40 MP use centered cover resizing |
| Types | PNG, JPG/JPEG, SVG |
| File limit | 8 MiB each |
| Scope | Top-level files only |
| Excluded | Links, subfolders, hidden/dot files, temporary downloads, incomplete or invalid files |
| Change detection | Debounced watcher plus five-second rescan |
| Duplicates | Same SHA-256 content is shown once |
| Original files | Never modified; resized output exists only in memory |
| Failure | Two bundled sample slides remain available |

The plugin never writes to the selected folder and never logs its full path.

Every generated large-display assignment persists `ActionParam.SmallViewMode: 2`. This returns the D200 center area to background-only mode when the page loads and prevents the clock overlay from reappearing.

## Toggle the large display

The **Setup Large Display** Property Inspector offers **Install**, **Repair**, and **Restore original**. Install and Repair require the built-in small-window action in slot `3_2`; Restore requires Image Slideshow plus the exact verified backup and receipt created by an earlier Setup patch.

1. Put **Setup Large Display** on an unused normal key; do not put it on the large display.
2. Choose the operation and press the key while Studio is open. The plugin starts a detached assistant and passes the validated normal-key coordinate and Setup action ID as separate process arguments. The helper performs read-only discovery and creates a request whose JSON is bound to a SHA-256 sidecar; only an opaque SHA-256 of the action ID is persisted.
3. Wait for **CLOSE STUDIO**, then close Studio manually.
4. The detached assistant revalidates the requested operation and exact store/group/current-page binding, creates a new safety backup, atomically patches or restores, validates readback, writes a receipt, and restarts the pinned executable.

`helper\Apply-ImageSlideSetup.cmd` remains available only as a manual recovery path for a valid prepared request.

The Setup key remains assigned after restart. Remove or reuse it manually when you no longer need it.

### Setup refuses instead of guessing

Setup supports only the locally verified Windows build below:

| Item | Pinned value |
|---|---|
| Executable | `C:\Program Files (x86)\UlanziDeck\UlanziDeck.exe` |
| File version | `3.2.11.0` |
| SHA-256 | `eee2458802e36170e8b09fe58d5d8f9b616813ee362fc83ac99884b3615509c4` |

Prepare resolves `Config\setting_source.json` using the observed fields `Devices[].CurrentProfile` and `Devices[].CurrentDevice`. Among same-name clones it inspects only each group's `Pages.Current` and requires an exact match for the pressed key, Setup action UUID, and action-ID hash. It checks `ProfilesV2` first and consults `ProfilesV1` only when V2 has zero valid matches. For restore, it accepts exactly one prior successful patch receipt whose target and before/current hashes match; it never chooses the newest or first backup. Apply opens only the receipt and backup pinned by the hashed request, then revalidates every target, receipt, backup, current-manifest, Setup-binding, and operation invariant.

The Setup Property Inspector and setup-key diagnostic display only a bounded `[CODE:PHASE]`. Restore-specific failures are `RESTORE_BACKUP_NOT_FOUND` and `RESTORE_BACKUP_INVALID`; other supported failures include `REPREPARE_REQUIRED`, `PROFILE_NOT_FOUND`, `PROFILE_AMBIGUOUS`, `SETUP_INSTANCE_NOT_FOUND`, `PAGE_INVALID`, `SLOT_UNRELATED`, `SETTINGS_SCHEMA_UNSUPPORTED`, `REQUEST_WRITE_FAILED`, `PROFILE_STORE_UNREADABLE`, `MANIFEST_INVALID`, `COMPATIBILITY_UNSUPPORTED`, and `HELPER_PROCESS_FAILED`. A persisted PREPARED diagnostic is never trusted by itself.

Compatibility subphases are `COMPAT_PLUGIN_ROOT`, `COMPAT_MANIFEST_READ`, `COMPAT_EXE_PATH`, `COMPAT_VERSION_READ`, `COMPAT_HASH_READ`, and `COMPAT_ENV_PATHS`. Every runtime file hash—including executable, manifest, request, backup, readback, receipt, installer artifact, and inventory hashes—uses a read-only .NET `FileStream` and disposes both stream and SHA-256 objects in `finally`. The delivered runtime contains no `Get-FileHash` dependency.

The state machine has only three outcomes: built-in small-window → patch, Image Slideshow with one exact verified patch lineage → restore, anything else → refuse. A replayed request is harmless because the current action/hash no longer matches its requested operation. Restore copies the exact pre-patch manifest bytes; it never synthesizes the built-in widget. A profile that arrived with Image Slideshow already assigned by import has no Setup patch lineage and therefore cannot be restored by this button; use the untouched original profile as its rollback authority.

## Acceptance checklist

- [ ] Existing Ulanzi plugins still appear.
- [ ] `Image Slideshow` is separate from the original `Arkamax` profile.
- [ ] The large display renders the first valid image immediately.
- [ ] Images rotate in the selected order and interval.
- [ ] Atomic file replacement is detected without showing incomplete content.
- [ ] Empty/deleted/inaccessible folders show bundled fallback slides.
- [ ] Leaving the active page stops slideshow scheduling and watching.
- [ ] Setup asks for Studio to be closed and never stops it itself.
- [ ] A second complete Setup cycle restores the exact pre-patch large-display behavior.

## Recovery

1. Close Studio.
2. Remove only `com.arkamax.ulanzi.imageslide.ulanziPlugin` if uninstalling this prototype.
3. Restart Studio and select/import the untouched original profile.
4. Delete only the `Image Slideshow` clone after the original works.

For a failed Setup apply, the helper attempts automatic byte-for-byte restoration from its verified backup. Preserve its backup directory and receipt if manual investigation is needed.

## Acknowledgements

Special thanks to the author of [chilleno/claude-deck](https://github.com/chilleno/claude-deck) for publicly documenting the profile technique that made safe use of the Ulanzi D200 large display possible. ImageSlidePlugin adapts that discovery to Windows with strict target validation, backups, atomic replacement, readback, rollback, and restore controls.

## Design evidence and limitations

- Studio 3.2.11 uses protocol 2.1.2 `setBaseDataIcon`; this package does not use the newer `setImage` API.
- Official Ulanzi Property Inspector contract: `selectFolderDialog()` returns through `onSelectdialog(message.path)`; global settings use `settings`, and PI pass-through uses `payload`.
- The private `3_2` patch follows the active device/profile/page resolution shape demonstrated by [chilleno/claude-deck](https://github.com/chilleno/claude-deck/blob/main/apply-bigkey.sh), adapted to Windows with strict compatibility, backup, atomic replacement, and rollback gates.
- The earlier manual Setup/Apply flow was physically validated on 0.1.9 after correcting the PowerShell 5.1 `File.Replace` backup path. The detached assistant retains that verified write path and its automatic wait/apply/relaunch lifecycle is physically validated.

Primary SDK references: [UlanziDeckPlugin-SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK), [plugin-common-html](https://github.com/UlanziTechnology/plugin-common-html).
