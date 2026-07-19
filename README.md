# hide-em

hide-em is a local, site-agnostic attention filter for Chromium browsers. Add a name, keyword, phrase, or regular expression and hide-em removes matching content cards from pages as they appear.

The extension has no backend, account, analytics, or cloud sync. Rules and settings stay in the browser profile where they were created. JSON import and export provide manual portability between devices and browsers.

## Features

- Universal text scanning with no site-specific rules or selectors
- Quick add popup from a normal click on the toolbar button
- Live current-page status and hidden-item count
- Reveal all hidden content and pause the current tab
- Temporary tab, timed-hostname, and browser-session pauses
- Full rule editing with aliases, whole-word matching, and case sensitivity
- Local rule testing before a rule is saved
- Blocklist search and filters for larger rule collections
- Optional regular expressions with validation for unsafe repetition patterns
- Domain exclusions that include subdomains, useful for sites such as Twitch
- Atomic JSON import with merge and replace modes
- Confirmed local saves with a local recovery backup
- Dynamic-page support for added content, changed text, and recycled cards
- Responsive popup and settings layouts for smaller screens

## Browser and account requirements

hide-em uses standard Manifest V3 Chromium APIs and targets Chrome, Edge, Brave, and other compatible Chromium browsers. It does not require a Chrome account or browser sign-in. Each browser profile keeps an independent local configuration unless the user moves it with JSON export and import.

Google Chrome currently limits Chrome Web Store extensions to computers and does not install them on mobile devices. See [Chrome Web Store Help](https://support.google.com/chrome_webstore/answer/1698338). The interface is responsive and ready for mobile Chromium browsers that provide compatible extension support, but hide-em cannot enable extension support in a browser that does not provide it.

## Install an unpacked development build

1. Install dependencies and build the extension.

   ```sh
   npm install
   npm run build
   ```

2. Open the browser's extensions page, such as `chrome://extensions`, `edge://extensions`, or `brave://extensions`.
3. Enable Developer mode.
4. Choose Load unpacked and select the generated `dist/` directory.
5. Pin hide-em to the toolbar if desired.

Existing tabs may need one refresh after the extension is first installed or reloaded.

## Use hide-em

Click the toolbar button to see whether filtering is active, view the number of currently hidden items, add a word or phrase, pause filtering temporarily, or exclude the current site. Select Manage rules and exclusions for the full settings page. The browser's normal right-click menu for the extension also links to its options page.

Temporary controls include:

- Show all hidden items and pause the current tab until it closes
- Pause the current hostname for 10 minutes
- Pause the current hostname until the browser restarts

Temporary pauses are held in browser session memory. They are not exported, synchronized, or added to browsing history. A tab pause follows navigation in the same tab and is removed when the tab closes.

An excluded domain also excludes its subdomains. For example, excluding `twitch.tv` also excludes `www.twitch.tv` and `chat.twitch.tv`, but not `nottwitch.tv`.

Import validates the entire JSON file before changing the active configuration. Merge adds new rules and exclusions without duplicating equivalent entries. Replace overwrites rules, settings, and excluded domains only after validation succeeds.

The options page can search rule values, aliases, and types, then filter by rule type or enabled state. The add and edit form includes a sample-text tester that uses the production matcher. Sample text remains only in the form and is never stored.

## Local storage and migration

Version 1.1 and later store the canonical configuration in `chrome.storage.local`. The background service worker is the only writer. It serializes changes, writes them, reads them back, and returns success only after verification. The visible UI does not add an item optimistically, so a failed save cannot look successful and then disappear after refresh.

Version 1.2 stores temporary pauses in `chrome.storage.session`, which is memory-only and clears when the browser restarts, the extension updates, or the extension reloads. Browsers without session storage use a local fallback that is cleared at browser startup. Neither path uses browser-account synchronization.

On the first run after upgrading from version 1.0, hide-em reads the old `chrome.storage.sync` rules and settings once and migrates valid data into local storage. It does not use sync for later changes. Invalid legacy rules are skipped without preventing valid rules from being recovered.

## Rule matching

Literal rules use Unicode normalization, collapse whitespace, remove zero-width characters, and ignore case unless case-sensitive matching is selected. Whole-word matching uses Unicode letter and number boundaries. Regex rules are compiled independently so capture groups and numeric backreferences keep their normal meaning.

The scanner hides conservative card-like ancestors such as `article`, `li`, ARIA article and listitem roles, common card identifiers, and Chromium custom renderer elements. It avoids broad section and figure containers. Work is split into short idle batches. A single scan that exceeds the safety limit disables scanning on that page and clears all hides.

For diagnostics, enable Debug logging and press Alt+Shift+D on a page. The page console also exposes:

```js
__heDebug.stats
__heDebug.kill()
__heDebug.unkill()
__heDebug.unhideAll()
__heDebug.rescan()
```

## Development

```sh
npm run dev          # Rebuild while files change
npm run typecheck    # TypeScript strict-mode check
npm run test         # Unit and DOM-target tests
npm run build        # Production extension build
npm run check        # Typecheck, tests, and production build
npm run package      # Check and create hide-em-<version>.zip
```

The release archive contains the contents of `dist/` at its root and can be uploaded to a Chromium extension store.

### Repository layout

```text
src/
  background/          Serialized storage owner and legacy migration
  content/             Scanner lifecycle, dynamic scanning, and target selection
  engine/              Pure text normalization, matching, and rule testing
  shared/              Types, validation, protocols, temporary controls, and storage clients
  ui/options/          Full React settings interface
  ui/popup/            Quick-add toolbar popup
scripts/               Release packaging
vite.config.ts         Manifest V3 definition and build configuration
```

## Architecture constraints

1. Scanning remains site agnostic. Do not introduce site-specific selectors or branches.
2. Page content is visible until a positive text match is found.
3. Matching logic remains independent of DOM and Chrome extension APIs.
4. Only the background service worker writes the stored configuration.
5. Page text and browsing history are never persisted or transmitted.

## License

MIT. See [LICENSE](LICENSE).
