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
