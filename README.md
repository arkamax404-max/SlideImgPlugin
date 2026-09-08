# Put an image slideshow on the Ulanzi D200 large display

Created by **Santiago Pérez**.

ImageSlidePlugin keeps Ulanzi Studio and its plugins intact. It installs **Image Slideshow**, imports an independently identified profile clone, and lets you combine local images, a localized clock, an optional WeatherAPI forecast, and system resource usage from the Property Inspector.

Version **0.7.3** is packaged from one source tree as one universal `*.ulanziPlugin.zip` for Windows x64, macOS x64, and macOS arm64. It automatically center-crops images of other sizes to 458 x 196 in memory while leaving the original files untouched.

An existing successful **0.1.9** Setup patch does not need to be patched again. Select **Restore original** before pressing Setup; 0.2.0 accepts that version's verified `apply-or-repair` receipt and backup, binds them into a new restore request, and restores the exact pre-0.1.9 bytes after Studio closes. Missing, ambiguous, changed, or tampered lineage fails closed.

> Safety boundary: Setup launches a detached assistant that prepares a hashed request while Studio is open. **You still close Studio manually when prompted.** Windows relaunches the pinned Studio executable after a verified operation. macOS does not relaunch Studio; reopen it manually after Setup finishes. The plugin never terminates Studio.

## Quick path

1. Keep your original `Arkamax` export. It remains the rollback authority.
2. Close Ulanzi Studio.
3. On Windows, run preflight:
   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-ImageSlidePlugin.ps1 -WhatIf
   ```
4. If Windows preflight prints `PASS`, run the same command without `-WhatIf`. On macOS, install the universal plugin package through Studio; the PowerShell installer is Windows-only.
5. Import `ImageSlide.ulanziDeckProfile` when prompted, or import it manually as **Image Slideshow**.
6. Select the slideshow action, choose a folder in its Property Inspector, and verify the physical D200.

## Choose images

The Property Inspector separates image, date/time, weather, and system-resource content. **Refresh folder** sits beside **Select folder**, and **Show image slideshow** controls whether images participate in the rotation. Settings are plugin-wide because the cloned profile has one large-display slideshow instance.

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

### Show date and time

The date/time screen updates once per second with a large clock and a bold weekday/date line.

| Mode or setting | Behavior |
|---|---|
| **Include date and time** | Adds the clock to the enabled content rotation |
| **Every (slides)** | With images enabled, number of images shown before inserting the clock |
| **Duration (seconds)** | How long the clock remains visible before the next enabled content |
| **System default** | Uses the Windows or macOS language, date order, and 12/24-hour preference |
| `DD/MM/YYYY` / `MM/DD/YYYY` | Overrides date order while retaining the localized weekday and system time format |

To show only information, disable **Show image slideshow**. Enable any combination of **Include date and time**, **Include weather forecast**, and **Include CPU, GPU, and RAM** to rotate them using their respective durations. Enable only one to keep that information screen continuously visible. Image folder settings remain saved while images are disabled.

### Show weather

Weather mode displays current conditions plus a three-day forecast using bundled [Meteocons](https://github.com/basmilius/meteocons) icons. Images and the date/time screen remain fully local; only weather refreshes require network access.

1. Create a WeatherAPI account and copy its API key.
2. Enable **Include weather forecast**.
3. Enter the key and a location such as a city, postcode, or `latitude,longitude`.
4. Choose Celsius/km/h or Fahrenheit/mph and press **Refresh weather**.

| Mode or setting | Behavior |
|---|---|
| **Include weather forecast** | Adds weather to the enabled content rotation |
| **Every (slides)** | With images enabled, number of images shown before inserting weather |
| **Duration (seconds)** | How long weather remains visible before the next enabled content |
| Forecast | Current conditions and three days, compatible with the WeatherAPI Free plan |
| Refresh | Every 30 minutes; failed updates retry after five minutes |
| Failure | Keeps the last forecast for the same location; image rotation continues if no forecast is available |
| Language | Weather condition text and day names follow the system language when WeatherAPI supports it |

The API key field is masked, but Ulanzi Studio stores the key in plain text with the plugin's global settings. The plugin sends it only to `https://api.weatherapi.com`, never logs it, and never includes it in display data. WeatherAPI's Free plan currently allows 100,000 calls per month and a three-day forecast; review [WeatherAPI pricing](https://www.weatherapi.com/pricing.aspx) for current terms. Weather data is provided by [WeatherAPI.com](https://www.weatherapi.com/).

Meteocons Static 0.1.0 is bundled under the MIT License. Its copyright and license text are included in `resources/weather/LICENSE-METEOCONS.txt`.

### Show system resources

Enable **Include CPU, GPU, and RAM** to add a three-card resource screen with the same visual language as weather. It refreshes every two seconds, can be inserted after a chosen number of images, and uses its configured duration when rotating with other information screens.

CPU and RAM use portable Node system APIs. GPU utilization is best-effort: Windows uses the built-in GPU performance counters, while macOS checks `IOAccelerator` and `AGXAccelerator` metrics without elevated permissions. The GPU card shows `N/A` when the operating system or graphics driver does not expose utilization; CPU, RAM, and the rest of the plugin continue normally.

Every generated large-display assignment persists `ActionParam.SmallViewMode: 2`. This suppresses the clock on the validated Windows path. **Known macOS limitation:** Studio can still render its clock overlay above the slideshow.

## Toggle the large display

The **Setup Large Display** Property Inspector offers **Install**, **Repair**, and **Restore original**. Install and Repair require the built-in small-window action in slot `3_2`; Restore requires Image Slideshow plus the exact verified backup and receipt created by an earlier Setup patch.

1. Put **Setup Large Display** on an unused normal key; do not put it on the large display.
2. Choose the operation and press the key while Studio is open. The plugin starts a detached assistant and passes the validated normal-key coordinate and Setup action ID as separate process arguments. The helper performs read-only discovery and creates a request whose JSON is bound to a SHA-256 sidecar; only an opaque SHA-256 of the action ID is persisted.
3. Wait for **CLOSE STUDIO**, then close Studio manually.
4. The detached assistant revalidates the requested operation and exact store/group/current-page binding, creates a new safety backup, atomically patches or restores, validates readback, and writes a receipt. Windows restarts the pinned executable. On macOS, wait for completion and reopen Studio manually.

`helper\Apply-ImageSlideSetup.cmd` remains available only as a manual recovery path for a valid prepared request.

The Setup key remains assigned after restart. Remove or reuse it manually when you no longer need it.

### Setup refuses instead of guessing

Windows Setup supports only the locally verified build below:

| Item | Pinned value |
|---|---|
| Executable | `C:\Program Files (x86)\UlanziDeck\UlanziDeck.exe` |
| File version | `3.2.11.0` |
| SHA-256 | `eee2458802e36170e8b09fe58d5d8f9b616813ee362fc83ac99884b3615509c4` |

Prepare resolves `Config\setting_source.json` using the observed fields `Devices[].CurrentProfile` and `Devices[].CurrentDevice`. Among same-name clones it inspects only each group's `Pages.Current` and requires an exact match for the pressed key, Setup action UUID, and action-ID hash. Windows checks `ProfilesV2` first and retains its validated `ProfilesV1` fallback. macOS supports **ProfilesV2 only**; ProfilesV1 has not been validated there. For restore, Setup accepts exactly one prior successful patch receipt whose target and before/current hashes match; it never chooses the newest or first backup. Apply opens only the receipt and backup pinned by the hashed request, then revalidates every target, receipt, backup, current-manifest, Setup-binding, and operation invariant.

The Setup Property Inspector and setup-key diagnostic display only a bounded `[CODE:PHASE]`. Restore-specific failures are `RESTORE_BACKUP_NOT_FOUND` and `RESTORE_BACKUP_INVALID`; other supported failures include `REPREPARE_REQUIRED`, `PROFILE_NOT_FOUND`, `PROFILE_AMBIGUOUS`, `SETUP_INSTANCE_NOT_FOUND`, `PAGE_INVALID`, `SLOT_UNRELATED`, `SETTINGS_SCHEMA_UNSUPPORTED`, `REQUEST_WRITE_FAILED`, `PROFILE_STORE_UNREADABLE`, `MANIFEST_INVALID`, `COMPATIBILITY_UNSUPPORTED`, and `HELPER_PROCESS_FAILED`. A persisted PREPARED diagnostic is never trusted by itself.

Compatibility subphases are `COMPAT_PLUGIN_ROOT`, `COMPAT_MANIFEST_READ`, `COMPAT_EXE_PATH`, `COMPAT_VERSION_READ`, `COMPAT_HASH_READ`, and `COMPAT_ENV_PATHS`. Every runtime file hash—including executable, manifest, request, backup, readback, receipt, installer artifact, and inventory hashes—uses a read-only .NET `FileStream` and disposes both stream and SHA-256 objects in `finally`. The delivered runtime contains no `Get-FileHash` dependency.

The state machine has only three outcomes: built-in small-window → patch, Image Slideshow with one exact verified patch lineage → restore, anything else → refuse. A replayed request is harmless because the current action/hash no longer matches its requested operation. Restore copies the exact pre-patch manifest bytes; it never synthesizes the built-in widget. A profile that arrived with Image Slideshow already assigned by import has no Setup patch lineage and therefore cannot be restored by this button; use the untouched original profile as its rollback authority.

## Acceptance checklist

- [ ] Existing Ulanzi plugins still appear.
- [ ] `Image Slideshow` is separate from the original `Arkamax` profile.
- [ ] The large display renders the first valid image immediately.
- [ ] Images rotate in the selected order and interval.
- [ ] Periodic date/time mode appears at the selected frequency and duration.
- [ ] Disabling images with date/time enabled keeps the localized clock visible.
- [ ] Weather mode shows current conditions and a three-day forecast without exposing the API key.
- [ ] Disabling images stops image monitoring and alternates date/time with weather when both are enabled.
- [ ] System resources update CPU/RAM every two seconds and show GPU utilization or a graceful `N/A` fallback.
- [ ] Atomic file replacement is detected without showing incomplete content.
- [ ] Empty/deleted/inaccessible folders show bundled fallback slides.
- [ ] Leaving the active page stops slideshow scheduling and watching.
- [ ] Setup asks for Studio to be closed and never stops it itself.
- [ ] A second complete Setup cycle restores the exact pre-patch large-display behavior.
- [ ] On macOS, Studio is reopened manually and the clock-overlay limitation is accepted.

## Recovery

1. Close Studio.
2. Remove only `com.arkamax.ulanzi.imageslide.ulanziPlugin` if uninstalling this prototype.
3. Restart Studio and select/import the untouched original profile.
4. Delete only the `Image Slideshow` clone after the original works.

For a failed Setup apply, the helper attempts automatic byte-for-byte restoration from its verified backup. Preserve its backup directory and receipt if manual investigation is needed.

## Acknowledgements

Special thanks to the author of [chilleno/claude-deck](https://github.com/chilleno/claude-deck) for publicly documenting the profile technique that made safe use of the Ulanzi D200 large display possible. ImageSlidePlugin adapts that discovery with strict target validation, backups, atomic replacement, readback, rollback, and restore controls.

Weather icons are from [Meteocons](https://github.com/basmilius/meteocons) by Bas Milius, used under the MIT License. Weather data is provided by [WeatherAPI.com](https://www.weatherapi.com/).

Clock and calendar symbols are from [Lucide](https://github.com/lucide-icons/lucide), used under the ISC/MIT terms included in `resources/LICENSE-LUCIDE.txt`.

## Design evidence and limitations

- Community Store artwork keeps a 2:1 cover and 3:2 banner under `resources/store`; delivery tests enforce both ratios with a small rounding tolerance and a minimum width of 1200 px.
- Studio 3.2.11 uses protocol 2.1.2 `setBaseDataIcon`; this package does not use the newer `setImage` API.
- Official Ulanzi Property Inspector contract: `selectFolderDialog()` returns through `onSelectdialog(message.path)`; global settings use `settings`, and PI pass-through uses `payload`.
- The private `3_2` patch follows the active device/profile/page resolution shape demonstrated by [chilleno/claude-deck](https://github.com/chilleno/claude-deck/blob/main/apply-bigkey.sh), adapted to Windows with strict compatibility, backup, atomic replacement, and rollback gates.
- The earlier manual Setup/Apply flow was physically validated on 0.1.9 after correcting the PowerShell 5.1 `File.Replace` backup path. The detached assistant retains that verified write path and its automatic wait/apply/relaunch lifecycle is physically validated.
- The official Ulanzi manifest reference defines the OS platform tokens as `windows` and `mac`, so source and release artifacts use those exact values. Earlier local Studio behavior was proven with an installed disposable ImageSlide copy and a third-party D200 plugin that use `macos`; those installed copies were not changed, and that runtime evidence is not represented as proof of the release-schema token.
- macOS x64 slideshow import/decode and ProfilesV2 Setup/Restore have physical evidence. Windows x64 installation, profile import, slideshow rotation, and clock suppression were physically rerun for this release. Darwin arm64 native packages are statically verified, not physically executed.

## Reproducible local package

Run `python3 tools/build_release.py` after tests pass. The builder downloads only lockfile-pinned runtime tarballs, verifies each SHA-512 integrity value, stages Sharp 0.35.4 for win32-x64, darwin-x64, and darwin-arm64, validates PE/Mach-O architectures without executing foreign binaries, and writes deterministic ZIP entries. It does not use host `npm install`, so optional-dependency pruning cannot remove another target platform.

Primary SDK references: [UlanziDeckPlugin-SDK](https://github.com/UlanziTechnology/UlanziDeckPlugin-SDK), [plugin-common-html](https://github.com/UlanziTechnology/plugin-common-html).
