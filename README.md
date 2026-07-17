# hide-em

hide-em is a local, site-agnostic attention filter for Chromium browsers. Add a name, keyword, phrase, or regular expression and hide-em removes matching content cards from pages as they appear.

The extension has no backend, account, analytics, or cloud sync. Rules and settings stay in the browser profile where they were created. JSON import and export provide manual portability between devices and browsers.

## Features

- Universal text scanning with no site-specific rules or selectors
- Quick add popup from a normal click on the toolbar button
- Full rule editing with aliases, whole-word matching, and case sensitivity
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

Click the toolbar button to add a word or phrase quickly, pause the extension, or exclude the current site. Select Manage rules and exclusions for the full settings page. The browser's normal right-click menu for the extension also links to its options page.

An excluded domain also excludes its subdomains. For example, excluding `twitch.tv` also excludes `www.twitch.tv` and `chat.twitch.tv`, but not `nottwitch.tv`.

Import validates the entire JSON file before changing the active configuration. Merge adds new rules and exclusions without duplicating equivalent entries. Replace overwrites rules, settings, and excluded domains only after validation succeeds.

## Local storage and migration

Version 1.1 stores the canonical configuration in `chrome.storage.local`. The background service worker is the only writer. It serializes changes, writes them, reads them back, and returns success only after verification. The visible UI does not add an item optimistically, so a failed save cannot look successful and then disappear after refresh.

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
  content/             Universal dynamic-page scanner and target selection
  engine/              Pure text normalization and matching
  shared/              Types, validation, domains, protocol, and storage client
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
