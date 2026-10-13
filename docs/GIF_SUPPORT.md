# GIF source contribution

The plugin's UUID, action IDs, folder, Santiago Pérez/MIT attribution, global
settings whitelist, version and Setup/restore compatibility remain upstream's.
Existing release archives are unchanged; release/version selection is a maintainer
decision. This branch adds GIFs to mixed top-level PNG/JPG/JPEG/SVG folders.

GIFs use the existing direct type-1 PNG image packet, preserving target IDs at
both envelope levels. One shared monotonic scheduler caps playback at 10 FPS,
checks a 1 MiB WebSocket backlog, coalesces bounded reads and drops late frames.
The slideshow/clock still runs at 1 Hz. GIFs count as one media item; dwell can end
a cycle early. Embedded finite loops retain their terminal frame independently
of gallery wrapping. Inspector closure does not stop animation.

Pinned Sharp 0.35.5/libvips composites all GIF pages once into a private temporary
source TIFF. Selected pages resize separately with the existing 458×196 centre-cover
behavior. Direct animated-strip resizing failed known frame-edge pixels, so it is
not used. High-rate sources are sampled after disposal/partial-frame compositing;
cycle duration and finite final pixels remain, while short transients may be skipped.
PNG compression is lossless; duplicate normalized frames reuse bytes. Source files
are never modified. ws 8.21.3 remains pinned; no additional dependency/service.

Discovery prepares posters; current/next clips prepare on demand through one worker
with two waiting jobs, a 30-second watchdog and ten-second idle exit. An atomic,
source-content/schema-keyed disk cache avoids repeat decoding/PNG encoding. Shared
LRUs: binary frames 8 MiB, send strings 2 MiB, metadata/posters 4 MiB each. Four
coalesced reads and eviction leases protect active/in-flight frames. Gallery/static
poster retention is bounded at 32 MiB; there is no per-frame processing queue.

Project limits, not firmware limits: GIF input 16 MiB; side 2048; 600 source frames;
64 million source pixels; 20-second effective cycle (zero delay = 100 ms); unique
prepared PNGs 64 MiB; disk cache 256 MiB/512 entries; temporary TIFF 272 MiB.
Worst-case temporary disk usage is about 592 MiB. This is not a process-RSS ceiling.
Cache lives under `Ulanzi/PluginMediaCache/com.arkamax.ulanzi.imageslide/png-v2` in
LOCALAPPDATA on Windows or Library/Caches on macOS. `SLIDEIMG_CACHE_ROOT` is a test
parent override using PID subdirectories, not an Inspector setting.

Malformed clips are skipped with actionable reasons; valid static content remains.
Refresh detects same-size/same-mtime replacements. Async scan/tick/preparation
generations prevent stale results after settings, deactivation or socket loss.

Limited hardware evidence: one development D200 setup showed native GIF animation
in Studio but a frozen physical frame; direct PNG playback worked. This adapted
upstream branch is not installed/hardware verified. Test Studio and the D200
separately for sustained playback, cadence, finite loops, information replacement,
page return, Inspector closure, reconnect, malformed input and rollback. macOS
animation and measured Studio responsiveness remain unverified.

Baseline Node 20: 58/59, one Windows ENOTEMPTY temporary-fixture cleanup failure.
Bounded cleanup retries change tests only; production Setup/build pins are untouched.
See GIF_TEST_RESULTS.md for final runs using synthetic media/fake sockets/timers.

Sources: https://sharp.pixelplumbing.com/api-constructor/,
https://sharp.pixelplumbing.com/api-output/#tiff,
https://raw.githubusercontent.com/libvips/libvips/v8.18.7/libvips/foreign/nsgifload.c,
https://github.com/UlanziTechnology/plugin-common-node.
