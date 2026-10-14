# Plexo for Windows + Chrome

Custom build: **2.0.0**, Windows x64. Based on the supplied Plexo source by Anmol Kapil; the original MIT license is retained. The desktop interface remains Electron, as requested. The browser helper is a compiled Windows .NET executable.

## Update an existing installation

Run the new **Plexo-2.0.0-setup.exe**. Replace the contents of the folder you previously loaded as an unpacked extension with the new **Plexo-Chrome.zip** contents. At **edge://extensions** or **chrome://extensions**, click **Reload** on Plexo, then refresh your open website tabs. The extension version must be **1.3.1** and app version **2.0.0**.

## YouTube

A small **Download this video** button appears at the top-right of the player. Click it to list the available resolutions, then choose a video-with-audio quality or audio-only. Plexo uses yt-dlp only to find fresh YouTube stream URLs; Plexo's native multi-connection download manager transfers the media bytes and shows its normal network and speed progress in the desktop app. Plexo combines separate video/audio streams locally with FFmpeg. The extension menu shows job status and the saved path. After selecting a format, Plexo asks for confirmation before transferring media.

Video and audio are combined with bundled FFmpeg when necessary; the resulting container may be MP4, WebM or MKV. Different qualities have distinct filenames. Page navigation and full-screen mode reposition the control. Disabling media buttons or excluding youtube.com hides it.

This build uses yt-dlp and Deno to resolve formats for public YouTube videos. The menu can retry a bot check with cookies from the current browser only after you choose “Retry ... with YouTube sign-in.” Plexo passes YouTube cookies and the matching browser User-Agent to its local helper for that metadata request, keeps cookies in memory, writes a temporary cookie file, and removes it when the request ends. Abandoned temporary files are cleaned the next time Plexo starts. Cookies are never copied to a media stream host or kept in the download queue. YouTube may still reject expired cookies or block the network; repeated authenticated retries may put the account at risk. This does not bypass DRM or interactive challenges, or download live broadcasts. Private/sign-in-required or unavailable videos may fail with an error in the menu. Active YouTube jobs stop when you quit Plexo; their job history is not persisted across app restarts. Reopen the same video while Plexo is running to reconnect to an active job. Partial temporary files are removed when a job ends.

## Install

1. Run **Plexo-Windows-Setup.exe**. Choose your installation folder. The installer creates shortcuts and registers the browser helper for your Windows account.
2. Extract **Plexo-Chrome.zip** into a permanent folder.
3. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`.
4. Pin **Plexo Download Manager** using Chrome's Extensions button. Open its popup; it should say **Connected**. Opening the popup can start Plexo automatically.
5. Download a file normally, or right-click a direct link and select **Download with Plexo**. Plexo asks before adding the browser download to its queue; YouTube asks after you choose a format and before any media bytes transfer.

The installer also includes an extension copy at `<installation folder>\resources\extension`; you can load that folder instead of extracting the ZIP. Keep the folder you loaded: Chrome needs it on future launches.

The matching extension ID is **hhepjnimojcdbcifmjaflopikglidjbo**. If Chrome shows a different ID, use the supplied extension without removing its manifest key.

**Plexo-Chrome.crx** is a signed CRX3 package. Ordinary Chrome on Windows restricts installation of extensions distributed outside the Chrome Web Store. Use the ZIP/developer-mode steps above for this private build. Store publication requires your developer account and review; this package has not been published. The CRX signature identifies the package, but is not a Chrome Web Store approval.

The Windows executable is not Authenticode-signed with a publisher certificate. Windows may show an unknown-publisher/SmartScreen prompt. The included SHA256SUMS.txt identifies the exact delivered files; it is not a publisher signature.

Chrome's official documentation: [alternative extension installation methods](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions) and [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

## Use

- **Automatic capture** is enabled initially. Toggle it in the extension to keep downloads in Chrome.
- Several downloads form a persistent queue. Plexo downloads one file at a time, using its existing parallel-connection engine for each file.
- View or remove waiting items in the extension. Pause, resume, cancel, or remove the current file in the desktop app. Completed downloads include **Open file** and **Show in folder** actions.
- The queue stops behind a paused or failed current download. Resume it, or remove/cancel it in Plexo to continue. A waiting item whose link check fails shows its error in the extension and can be removed and sent again.
- **Media buttons** appear beside directly downloadable audio and video players; Plexo no longer adds a floating button at the bottom of webpages. Direct media served through network requests can also appear.
- **Find media** lists direct audio/video URLs visible in the current page's DOM. It does not extract segmented streaming services.
- Add comma-separated hostnames under **Settings and setup** to exclude sites from automatic capture. An entry also covers its subdomains.
- Closing the Windows window leaves Plexo running in the system tray. Double-click its tray icon to reopen it. Use **Quit Plexo** in the tray menu to exit; active downloads are paused for recovery.
- Downloads use the folder selected in Plexo, or the Windows Downloads folder by default.
- The app asks before accepting a captured download into its queue and checks the response first. If the server returns 403 or a challenge page, or the app cannot accept it, the extension resumes the original Chrome download. After Plexo has accepted it into its encrypted queue, subsequent server failures are shown in Plexo or the extension rather than silently downloading a second copy in Chrome.

## Compatibility

Designed for ordinary HTTP/HTTPS GET file downloads, redirects, cookie-authenticated links, bearer-authenticated requests observed by the extension, and direct audio/video files. Range-capable servers use Plexo's multi-connection engine; servers without ranges use a single stream. Exact bytes were checked against local test origins.

This is not full IDM/FDM parity and has not been tested against most public websites. Except for the dedicated public-YouTube workflow above, DRM, HLS/DASH playlists, `blob:`/`data:` URLs, POST-generated downloads, private browsing, browser security-blocked downloads, and interactive anti-bot/login challenges remain in the browser or are unsupported. A short-lived or single-use URL may expire while queued. If a browser request cannot be identified as a recent GET, automatic capture leaves it in Chrome. Use a fresh direct link, or disable capture for that site.

Credentials are forwarded only to the original URL's exact origin. A redirect to a different origin never receives those credentials; a site that requires cross-origin credentials may need to stay in Chrome. Multi-interface downloads remain dependent on Windows routing and the server's policies, as in the original app.

The extension works with Chromium-based APIs and the installer registers both Chrome and Edge. Edge can load the same folder at `edge://extensions`. Automated live-browser validation on this machine used Edge because downloaded Chrome-for-Testing executables failed to start with a Windows side-by-side configuration error. Chrome stable was not installed here, so a Chrome-stable run remains unverified.

## Privacy and local storage

The extension observes recent request headers to preserve authenticated downloads. Its short-lived cache lives in browser session storage (up to 150 URLs, two-minute matching window), not extension local storage. Incognito requests are excluded. Cookies/authorization passed to Plexo are encrypted using Electron safeStorage/Windows DPAPI in the queue and resumable-download metadata. Credentials cannot be decrypted by another Windows account through DPAPI. Normal download URLs and filenames remain in the app's ordinary metadata.

Communication uses Chrome Native Messaging, a compiled helper, and a local Windows named pipe. No localhost HTTP listener or external backend is added. The helper allowlists the extension ID. As with ordinary local desktop apps, this is not a security boundary against other programs running as your Windows user.

## Troubleshooting and removal

- **App unavailable:** finish the Windows installation, close and reopen Chrome, and click **Open app**. Re-running the installer repairs the native messaging registration.
- **No automatic capture:** confirm the toggle is enabled, the site is not excluded, and the download is a normal GET file. Private, form, generated, and safety-flagged downloads stay in Chrome.
- **YouTube video does not start:** cancel the job, retry, and select a lower resolution. A video restricted to signed-in viewers or unavailable in your region may remain inaccessible.
- **403/login page/expired URL:** download normally in Chrome or obtain a new direct link; do not repeatedly resume an expired link.
- **Queue waiting:** inspect the desktop app for a paused/failed current download. Remove a failed waiting item in the popup and send its link again.
- Uninstall Plexo using Windows Installed apps, and remove the extension at `chrome://extensions`. Downloaded files are retained. User preferences and encrypted recovery data may remain under `%APPDATA%\Plexo`.
- This custom build does not offer upstream updates that would remove its browser integration. Install future custom builds manually.

## Rebuild and test

Extract **Plexo-Source.zip**. Install Node.js 22 or newer and use Windows with the .NET Framework C# compiler. Then run:

```powershell
npm ci
npm run build:win
```

The build fetches media executables using the hashes in media-tools.lock.json when not already present. A moved upstream FFmpeg asset will fail verification; updating that dependency requires reviewing a new lock file. See THIRD-PARTY-MEDIA.md for component sources and licenses.

The result appears in `release/`. The build compiles the .NET helper, signs the CRX3 with a local RSA key, compiles TypeScript/React, and creates the NSIS Windows x64 installer. A new `.signing/extension.pem` is generated if none exists, which changes the extension ID. Preserve the original key to maintain this delivered extension identity. The separately supplied **Plexo-Maintainer-Key.zip** contains that private key; extract it into the source root before rebuilding. Keep it private and do not publish it with the public source.

Validation commands:

```powershell
npm run lint
npm run typecheck
npx playwright test e2e/download.spec.ts e2e/lifecycle.spec.ts --workers=2
# Uses an isolated browser profile, test-only native host and named pipe.
$env:PLEXO_TEST_BROWSER = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npx playwright test e2e/browser.spec.ts e2e/pageButtons.spec.ts e2e/youtube.spec.ts --workers=1
node scripts/test-youtube.cjs
node scripts/verify-extension.cjs
```

Browser integration tests use separately compiled test helpers and randomly named host registrations and pipes, so they do not redirect your installed extension. The YouTube test requires internet access and uses a public test video. The remaining inherited tests and their fixtures are included in the source. Some multi-network tests require a second usable network interface.
