# Migrate from the Big Background prototype

ImageSlidePlugin intentionally uses a new identity. It does not upgrade or alias `com.arkamax.ulanzi.bigbackground`.

## Migration

1. Keep the original `Arkamax` profile.
2. Close Studio and install `com.arkamax.ulanzi.imageslide.ulanziPlugin`.
3. Import the new `ImageSlide.ulanziDeckProfile` clone.
4. Select **Image Slideshow**, choose the external folder again, and complete the physical test.
5. After the new profile works, remove or ignore the old Big Background profile and plugin.

## Identity changes

| Component | Old prototype | ImageSlidePlugin |
|---|---|---|
| Main UUID | `com.arkamax.ulanzi.bigbackground` | `com.arkamax.ulanzi.imageslide` |
| Slideshow action | `com.arkamax.ulanzi.bigbackground.slideshow` | `com.arkamax.ulanzi.imageslide.slideshow` |
| Setup action | Not available | `com.arkamax.ulanzi.imageslide.setup` |
| Package | `com.arkamax.ulanzi.bigbackground.ulanziPlugin` | `com.arkamax.ulanzi.imageslide.ulanziPlugin` |

Global settings do not migrate automatically because the UUID namespace changed. This is intentional: silent reuse would undermine the prototype identity reset.

## Updating 0.1.x to 0.2.0

Close Studio and reinstall the 0.2.0 package. The UUIDs remain stable, but the profile clone is regenerated so its slideshow action metadata reports 0.2.0. Any PREPARED state from an older build is intentionally refused: start Studio and press Setup again to create a version-bound request. Apply uses a real confined backup path for both atomic replacement and rollback, avoiding the PowerShell 5.1 null-backup failure in 0.1.8.

Version 0.2.0 also turns the same normal Setup key into a safe toggle. Only a slideshow assignment created by a successful Setup patch can be restored: the helper requires the exact cryptographically bound pre-patch backup and receipt. Imported profiles without that lineage remain fail-closed and must use their untouched exported original for rollback.

A successful 0.1.9 Setup patch is a supported restore lineage. Install 0.2.0, return to the same active page and Setup key, and press Setup once to prepare the restore; a fresh 0.2.0 patch cycle is not required. The old receipt and backup must still be intact and the current manifest must match the recorded 0.1.9 post-patch hash.

## Updating 0.2.0 to 0.3.0

Close Studio and reinstall the plugin package. Version 0.3.0 adds automatic centered-cover resizing for non-458 x 196 images and leaves originals untouched. Existing action UUIDs, settings, Setup backups, receipts, and restore lineage remain valid; any already prepared 0.2.0 request must be prepared again after upgrading.

## Updating 0.3.0 to 0.3.1

Version 0.3.1 keeps the same runtime behavior and normalizes the public repository layout for Community Store discovery. Reinstall only if you want installed metadata to report 0.3.1; action UUIDs, settings, backups, receipts, and restore lineage remain compatible.

## Updating 0.3.1 to 0.3.2

Version 0.3.2 corrects the public author metadata to Santiago Pérez. Runtime behavior and all persisted identities remain unchanged.

## Updating 0.3.2 to universal 0.4.0

Version 0.4.0 keeps the plugin UUID and both action UUIDs unchanged while adding one universal package for Windows x64 and macOS x64/arm64. Existing Windows Setup behavior, backups, receipts, and ProfilesV1 fallback remain unchanged.

On macOS, Setup is deliberately limited to ProfilesV2. Close Studio when prompted and reopen it manually after the helper completes; automatic relaunch is not implemented. The slideshow works on the center display, but the Studio clock overlay can remain visible. Windows x64 and macOS x64 are physically validated; macOS arm64 remains statically validated only.

## Updating 0.4.0 to 0.5.0

Version 0.5.0 keeps the plugin UUID, action UUIDs, image settings, Setup backups, receipts, and restore lineage compatible. Existing installations gain an optional localized date/time screen without a settings migration; it is disabled by default.

Use **Show date and time between slides** to configure its image frequency and visible duration. Use **Date and time only** to stop image rotation and folder monitoring while keeping the clock visible. **System default** follows the host language, date order, and 12/24-hour preference on Windows and macOS; explicit `DD/MM/YYYY` and `MM/DD/YYYY` overrides are also available.

## Updating 0.5.0 to 0.5.1

Version 0.5.1 fixes Setup state and Restore lineage across newly created pages and repeated Windows `Install -> Restore` cycles. Existing 0.5.0 backups and receipts remain valid. New Windows patch receipts include a center-action fingerprint, and the helper prefers that stronger lineage over compatible legacy receipts without choosing by timestamp.

## Updating 0.5.1 to 0.6.0

Version 0.6.0 adds optional WeatherAPI current conditions and a three-day forecast in periodic or weather-only modes. Existing image, date/time, Setup, backup, and receipt behavior remains compatible, and weather is disabled by default. Users who enable it provide their own WeatherAPI key and location in the Property Inspector.

## Updating 0.6.0 to 0.7.0

Version 0.7.0 replaces separate date-time-only and weather-only switches with independent image, date/time, weather, and system-resource content choices. Existing settings migrate automatically. With images disabled, enabled information screens rotate by duration; with images enabled, simultaneously due panels run sequentially as date/time, weather, then system resources before images resume.

The release also adds the cross-platform CPU/GPU/RAM panel. CPU and RAM are available on Windows and macOS; GPU is best-effort and displays `N/A` when the operating system or driver does not expose utilization.

## Updating 0.7.0 to 0.7.1

Version 0.7.1 corrects the Community Store cover and completes the public description of independent image, clock, weather, and CPU/GPU/RAM content. Runtime behavior and persisted settings remain unchanged.

## Updating 0.7.1 to 0.7.2

Version 0.7.2 formalizes Community Store artwork validation at a 16:9 cover ratio and 3:1 banner ratio. Runtime behavior, persisted settings, and the current artwork remain unchanged.
