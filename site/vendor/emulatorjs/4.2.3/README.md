# EmulatorJS 4.2.3 — original SNES touch control

Source: [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3),
licensed under GPL-3.0 (see LICENSE).

`snes-touch.js` contains the SNES layout, button renderer and continuous D-pad
from `EmulatorJS.setVirtualGamepad`, extracted from the same pinned release used
by the host. `snes-touch.css` contains its original control styles, unmodified.
Other consoles, speed/rewind commands and the emulator menu are omitted because
the guest only sends SNES inputs to Player 2. Queued button releases use the
adapter's cancellable scheduler instead of `window.setTimeout`.

`site/guest-touch.js` supplies the DOM/event adapter, Portuguese labels, input
masks and lifecycle cleanup. It does not instantiate an emulator or load a ROM.
The host's code and controls are unchanged.

To reproduce these files, download
`https://cdn.emulatorjs.org/4.2.3/data/src/emulator.js` and
`https://cdn.emulatorjs.org/4.2.3/data/emulator.css` to a temporary directory, then
run `node tools/extract-emulator-touch.mjs <directory>`. The extractor verifies
both upstream SHA-256 hashes before writing output. It does not access catalogs.
