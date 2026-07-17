# Changelog

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
