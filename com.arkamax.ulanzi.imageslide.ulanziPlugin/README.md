# Image Slideshow plugin

Edit `config.json`, place PNG/JPG/SVG files in `slides/`, and restart Ulanzi Studio. Exact 458 x 196 images pass through unchanged; other sizes are center-cropped to 458 x 196 in memory without modifying the originals. The minimum interval is 5 seconds. The plugin is offline and only renders contexts assigned to key `3_2`.

The normal **Setup Large Display** action provides Install, Repair, and Restore operations. Press the assigned key while Studio is open, then close Studio only when it displays **CLOSE STUDIO**. Windows restarts the validated Studio executable; on macOS, reopen Studio manually after the ProfilesV2-only helper completes. The macOS clock overlay can remain visible in this release.

Full install, safety, and recovery instructions are in the top-level `README.md` delivered with this package.
