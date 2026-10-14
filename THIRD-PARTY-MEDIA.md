# Bundled media components

Plexo runs these as separate executables. Their licenses are included beside them in the installed resources/media-tools folder; they do not replace the original Plexo MIT license.

- yt-dlp 2026.08.19: https://github.com/yt-dlp/yt-dlp/tree/2026.08.19 — its Windows executable includes additional third-party components; see the upstream license notice and source repository.
- Deno 2.9.7: https://github.com/denoland/deno/tree/v2.9.7 — MIT license.
- FFmpeg N-127451-g263f271422, build 20261012: https://github.com/yt-dlp/FFmpeg-Builds — GPLv3 build with shared libraries. FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/263f271422 . Build scripts and dependency sources are referenced in the upstream build repository. Included LICENSE.txt contains the GPL text.
- `@cloudflare/speedtest` 1.14.2: https://github.com/cloudflare/speedtest — MIT license; license text is included in `third-party-licenses/cloudflare-speedtest-MIT.txt`. The speed-test display is inspired by Silizium from https://github.com/TechnoHoschi/openspeedtest-openwrt (MIT; license text is included in `third-party-licenses/silizium-MIT.txt`). Plexo uses Cloudflare's measurement endpoints for real internet speeds; Silizium's router-local engine measures LAN speed and is not used as a simulated internet test.

Original release URLs and archive digests are recorded in media-tools.lock.json. Keep component notices and applicable source requirements when redistributing these binaries. No component is silently self-updated by Plexo.
