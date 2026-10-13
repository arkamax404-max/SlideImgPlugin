# Independent profile preferences (source contribution)

This change proposes profile-specific folder, dwell, sorting, gallery looping,
clock, weather and system-resource preferences. It is separate from GIF support:
this branch still accepts PNG/JPG/JPEG/SVG only. The current release documents
plugin-wide settings; changing this behavior requires explicit maintainer review.

## Identity and migration

Retain the original plugin `com.arkamax.ulanzi.imageslide`, action UUIDs, folder,
author/MIT license, version 0.8.1, Setup code, pinned Studio builds, receipts,
profile generator, installer and release archives. No fork receipt or preference
namespace is adopted. The existing shared configuration seeds a copy for each
profile on first use. The original flat snapshot remains for older-version rollback.
Preferences stay in the SDK global-settings store under a versioned registry;
they do not enter saved action parameters or change SmallViewMode:2.

Before each save, verify private initial/latest preference backups with SHA-256,
then request SDK readback of the full candidate registry. Serialized saves and
revisions protect concurrent updates and ignore older echoes. Unknown schemas,
ambiguous identities, missing backup integrity and registry loss refuse writes.
Limits: 256 profile leaves and 1 MiB serialized preferences. Backup files contain
only this plugin's preferences, never the whole Studio configuration, and are
never included in source/release archives or logs.

Backups: `Ulanzi/PluginPreferences/com.arkamax.ulanzi.imageslide/profile-v1` under
LOCALAPPDATA on Windows or Library/Application Support on macOS. Restore only
this plugin's backed-up preferences through its SDK route; never replace Studio's
entire global settings file. Previous-version edits can erase the registry, so
retain the private backup when rolling back.

## Private binding boundary

The legacy SDK supplies action UUID/key/ActionID, not a documented profile getter.
Resolve the exact large-slot action against read-only saved D200 profile metadata,
prefer ProfilesV2 over V1, share preferences between pages of one group, and use
separate opaque group keys across profiles. Missing metadata falls back to an
isolated display-instance key with an Inspector warning. Ambiguous matches refuse
saves. Bound traversal to 256 groups, 512 pages per group, 1 MiB per JSON, 8 MiB/
2048 JSON reads and five seconds; refuse links. This is an observed private storage
technique, not a public profile/large-display assignment API. No saved profile or
Studio executable is written, and no compatibility pin is relaxed.

One profile/page context owns a physical D200 large slot at a time. Older async
activations cannot reclaim or deactivate a newer owner. Clear/deactivation/socket
loss release its display and gallery work. One shared 1 Hz gallery clock, bounded
static-gallery budget, coalesced folder watchers, weather requests and system
samples serve profile engines. The Inspector binds its action context once,
ignores other actions' packets, and waits for its scoped settings to be ready.

## Validation and rollout

Synthetic tests cover preference copying, save/readback/rollback snapshots,
concurrent saves, stale schemas/echoes, ambiguity/fallback, same-profile pages,
profile switch/return, same-context late activation, reconnect, shared resources,
backup tampering and cleanup. Setup tests use temporary profiles only. The adapted
upstream branch is not installed or physically tested. Verify profile A/B folders,
all information preferences, page return, Inspector closure, restart/reconnect and
rollback on a separately approved test installation.

Both contributions target main independently. If GIF support and this feature are
accepted, reconcile the slideshow/Inspector/bootstrap overlap rather than replacing
one implementation wholesale. In particular, use the GIF media player/worker in the
profile runtime while retaining profile-specific settings and display ownership.
