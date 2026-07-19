# Changelog

## 1.2.0

- Added live current-page scanner status and an exact current hidden-item count to the toolbar popup.
- Added a reveal-and-pause action so users can immediately recover content hidden by a broad rule.
- Added temporary pauses for the current tab, the current hostname for 10 minutes, or the current hostname until browser restart.
- Stored temporary controls only in in-memory session storage, with automatic expiration and closed-tab cleanup.
- Added blocklist search with type and enabled-state filters.
- Added a local rule tester for unsaved literals, aliases, whole-word rules, and regular expressions.
- Refactored the scanner into a testable lifecycle controller with explicit active, paused, excluded, disabled, and safety-stop states.
- Added service-worker, temporary-state, scanner-lifecycle, rule-filter, rule-tester, and client error-path coverage.
- Preserved the existing permission set, local-only configuration, JSON portability, and site-agnostic scanner.

## 1.1.0

- Moved canonical configuration from sync storage to verified local storage, with one-time legacy migration and local backup recovery.
- Added a toolbar popup for quick rule creation, extension pause, current-site exclusion, and options access.
- Added domain exclusions with exact and subdomain matching.
- Added atomic JSON import with merge and replace choices, plus settings and exclusions in exports.
- Added visible save success and failure states so unsaved changes cannot appear committed.
- Hardened regular expression validation and preserved capture-group backreferences.
- Improved dynamic-page scanning for character-data changes, nested phrases, and recycled content cards.
- Added responsive options and popup layouts.
- Updated the build and test toolchain and resolved dependency audit findings.
- Added validation, storage-operation, domain, protocol, matcher, and DOM-target tests.
