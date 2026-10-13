# Validation — 13 October 2026

Original baseline: Plexo 1.0.0-browser.1, Windows x64.

## Native YouTube transfers: 1.0.0-browser.5

- yt-dlp now only resolves current YouTube metadata and signed media URLs; Plexo's `DownloadManager` downloads each selected video/audio stream with parallel HTTP range requests and the user's active network interfaces. FFmpeg only muxes the finished streams.
- The existing YouTube cookie retry is scoped to the metadata request. Cookie files are deleted after that request; no cookie header is sent to Google Video stream hosts.
- Browser-captured downloads yield the single Plexo transfer slot to an active YouTube media job, so another queued item cannot interrupt the video/audio pair.
- TypeScript and ESLint passed after this change. No end-to-end or network transfer verification was run for this revision.

## YouTube completion notification and MP4 naming: 1.0.0-browser.6

- Individual Plexo transfers for YouTube's temporary video/audio streams suppress their normal completion notifications. Plexo reports completion once the finished MP4 is muxed and ready.
- Video downloads use the YouTube title as the output name with an `.mp4` extension. Plexo first remuxes without re-encoding and falls back to H.264/AAC conversion if the selected streams cannot be muxed into MP4 directly. Audio-only downloads keep their audio extension.
- TypeScript checks for main/preload/shared, renderer, and end-to-end types passed; ESLint passed.
- FFmpeg's bundled build includes `libx264`; the Windows x64 installer, Chrome ZIP, and CRX3 rebuilt successfully with the existing extension ID.
- No automated or live YouTube download test was run for this revision.

## Previous YouTube and page-button update: 1.0.0-browser.3 / extension 1.2.0

- Final update checks: **4 browser integration tests passed** (52.1 seconds), **3 backend tests passed**, TypeScript and ESLint passed, Windows installer rebuilt, CRX3 signature verified, packaged media/extension files verified against tested files.
- Real Edge extension + isolated native helper + Electron end-to-end YouTube test passed. A deterministic YouTube-origin player layout loaded the extension. Actual public YouTube metadata and media were fetched by the bundled engine.
- The public video "Me at the zoo" (jNQXAC9IVRw) downloaded successfully. FFprobe confirmed both video and audio streams in the resulting media file.
- Tested compact menu, actual available qualities, synthetic click rejection, SPA navigation, page-button toggle, and invalid native URL rejection.
- Three backend tests passed: format injection rejection, DRM-format filtering, cancellation before asynchronous preparation, child-process cancellation, progress and saved-path reporting, duplicate inspection, and shutdown cleanup.
- Earlier page-button tests passed: dynamic links, network-detected media, original browser transfer retained after native 403, POST downloads retained in browser, unsupported segmented streams and visibility setting.
- Media binary archives were verified against GitHub release SHA-256 digests; versions and hashes are in media-tools.lock.json. The new engine uses no shell commands for download arguments and passes only canonical YouTube URLs and internally selected format expressions.
- At that revision, YouTube media bytes were transferred by yt-dlp. The current 1.0.0-browser.5 path is described above and uses Plexo's download manager for the transfers.
- Screenshot is a deterministic player-layout fixture, not a screenshot of YouTube's current production interface. No broad public-site survey was performed.

## Original baseline passed

- TypeScript checks for main/preload/shared, renderer, and end-to-end tests.
- ESLint, with no errors or warnings on the final code.
- Electron/Vite production build and NSIS x64 installer build.
- Final targeted regression run: **29 passed, 1 skipped**, in 38.4 seconds. Suites: `download.spec.ts`, `lifecycle.spec.ts`, `browser.spec.ts`.
- HTTP range transfers, whole-file fallback without range support, unknown/zero sizes, IPv6, redirects, filename sanitization, collision handling, pause/resume, cancellation, changed-file protection, and byte-for-byte integrity.
- Compiled C# helper: binary native-messaging framing, fragmented input, extension-origin rejection, invalid URL rejection, and real communication with Electron over a named pipe.
- Browser queue: authenticated downloads, duplicate submission handling, persistent queue, pause/restart recovery, and multiple queued transfers.
- Security checks: cookies absent in plaintext from queue/manifest files; credentials withheld from a different origin during redirects.
- Real browser run in **Microsoft Edge using Chromium extension APIs**, with an isolated profile: extension loaded, native connection established, authenticated automatic download handoff completed with exact bytes, popup rendered without page errors, and browser fallback completed when the host registration was removed.
- RSA verification of CRX3 signed data; embedded ZIP equality; matching extension manifest key, extension ID, and native host allowlist.
- **Actual installer smoke test:** installed silently into a temporary workspace directory (exit 0); both Chrome and Edge native-host registry paths pointed to the installed manifest; installed application launched in an isolated profile; installed compiled helper successfully queried the application; uninstalled successfully (exit 0); both native-host registration keys were removed. The temporary installation was not left installed.
- Production dependency audit: **0 known vulnerabilities** reported by `npm audit --omit=dev` at build time.

## Limits

- One two-network attribution test was skipped because no second usable network interface was available. Multi-interface performance was not measured on real internet connections.
- Downloaded Chrome-for-Testing 153 and 145 could not launch on this Windows environment due to side-by-side assembly configuration errors. Chrome stable was not installed. The live extension test therefore used Edge; a Chrome-stable run is still unverified.
- No broad public-site compatibility survey was performed. Passing local protocol tests does not establish compatibility with most websites, DRM, anti-bot systems, site-specific media extractors, or every login/session mechanism.
- The installer is unsigned with respect to Windows Authenticode; the CRX has its own valid RSA package signature. No public-store submission, publisher-certificate signing, or automatic update service is included.
- The full development-tool dependency audit retains **8 moderate findings**, principally in the inherited Electron-builder download/proxy dependency chain. These are development dependencies, excluded from the production dependency audit. No forced major-version substitution was made to that toolchain.
- The full inherited test suite was not run; the relevant download, lifecycle, and new browser-integration suites were run. The source retains the remaining suites.
