# Privacy Policy for hide-em

Last updated: July 15, 2026

hide-em is a personal attention filter that runs entirely inside the user's browser.

## Summary

- hide-em does not collect, transmit, sell, or share personal data.
- hide-em has no analytics, telemetry, advertising, remote logging, or crash-reporting service.
- hide-em makes no requests to a server operated by the developer or a third party.
- hide-em does not require an account or browser sign-in.
- Configuration stays in the local browser profile unless the user manually exports it as JSON.

## Data stored locally

hide-em uses `chrome.storage.local` to store:

- Blocklist rules, aliases, and matching options
- Extension enabled and debug settings
- Excluded domain names
- A small list of processed change identifiers used to prevent duplicate saves
- A local configuration backup used to recover from corrupted storage

This data is not synchronized by hide-em. A user can manually move configuration to another browser or device with JSON export and import.

When upgrading from an older release, hide-em may read its own legacy rules and settings from `chrome.storage.sync` once so it can copy them into local storage. New changes are not written to sync storage.

## Page processing

The extension reads page text in the active tab and compares it with locally stored rules. This work occurs inside the browser tab. Page text is not saved, transmitted, or shared.

The toolbar popup reads the current page address in memory so it can show and manage a domain exclusion. hide-em stores only a domain the user explicitly chooses to exclude. It does not store paths, queries, page titles, or browsing history.

## Permissions

- `storage`: saves local rules, settings, exclusions, and the recovery backup.
- Host access to `<all_urls>`: lets the universal content script apply user-created rules on web pages and lets the popup identify the current web domain. Users can exclude domains where scanning is not wanted.

hide-em does not request the `tabs`, `webRequest`, `cookies`, `history`, or `bookmarks` permissions.

## Third parties

The extension contains no third-party analytics SDK, advertising network, hosted service, or remote-code dependency. Build-time open-source packages are bundled into the published extension where needed. No code is downloaded or executed remotely at runtime.

## Children

hide-em is not directed at children and does not knowingly collect data from anyone.

## Changes

If this policy changes, the updated policy and date will be published with the extension and in this repository.

## Contact

Privacy questions can be sent to mgelsinger@proton.me.
