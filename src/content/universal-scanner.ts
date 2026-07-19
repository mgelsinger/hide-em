import { getTemporaryControl } from '../shared/page-control-client.js';
import {
  isPageControlApply,
  isPageStatusRequest,
} from '../shared/page-control.js';
import { getConfig, onConfigChanged } from '../shared/storage.js';
import { ScannerController } from './scanner-controller.js';

const controller = new ScannerController(location.hostname);

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isPageStatusRequest(message)) {
    sendResponse(controller.getStatus());
    return false;
  }
  if (isPageControlApply(message)) {
    controller.applyTemporary(message.resolution);
    sendResponse(controller.getStatus());
    return false;
  }
  return false;
});

window.addEventListener('keydown', (event) => {
  if (event.shiftKey && event.altKey && event.key.toLowerCase() === 'd') controller.toggleOverlay();
});

async function init(): Promise<void> {
  const [config, temporary] = await Promise.all([
    getConfig(),
    getTemporaryControl(location.hostname).catch((reason: unknown) => {
      console.warn('[hide-em] temporary controls were unavailable; continuing with persistent settings', reason);
      return null;
    }),
  ]);
  if (temporary) controller.applyTemporary(temporary.resolution);
  controller.applyConfig(config);
  onConfigChanged((next) => controller.applyConfig(next));
}

void init().catch((reason: unknown) => {
  controller.destroy();
  console.warn('[hide-em] scanner could not start', reason);
});

(window as unknown as { __heDebug: unknown }).__heDebug = {
  get stats(): Record<string, unknown> { return controller.getStats(); },
  kill(): void { controller.kill(); },
  unkill(): void { controller.unkill(); },
  unhideAll(): void { controller.showAll(); },
  rescan(): void { controller.rescan(); },
};
