# PROFILE contribution validation ? 2026-10-13

Upstream base: cd8c36cb7a9cb0d632fa048777c23f938ed9f5c8 (0.8.1).
Baseline Node 20.12.2: 58/59; one Windows ENOTEMPTY temporary-fixture cleanup failure.
Final Node 20.12.2 and 24.21.0: **73/73 pass each**, zero skips.
Final Python: **34/34 pass**, zero skips, using original synthetic profile fixtures
for previously optional Windows profile checks. Native package architecture and
lock-integrity checks pass for Windows x64 and macOS x64/arm64. Local validation
packages were rebuilt; original tracked release archives/checksums were restored
byte-for-byte and are not part of this source PR.

The bundled stage smoke uses the original upstream UUID, fake sockets and temporary
data. No installed plugin/profile, Studio executable or audio configuration was
modified. This adapted upstream branch has not been physically validated; simulator/
fake packet success is not proof of D200 rendering. No store/release submission.

Identity audit: manifest, package/lock, Setup service/helper scripts, installer,
profile generator, store metadata, resources, release archives/checksums and profile
receipts retain upstream identity. MIT copyright Santiago P?rez remains intact.
