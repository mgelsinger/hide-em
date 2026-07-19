import { hostnameMatches } from './domains.js';

export const TEMPORARY_CONTROL_KEY = 'temporaryControlV1';
export const TEMPORARY_CONTROL_VERSION = 1 as const;
export const TEN_MINUTES_MS = 10 * 60 * 1000;

export type TemporarySitePause = {
  hostname: string;
  createdAt: number;
  expiresAt: number | null;
};

export type TemporaryControlState = {
  version: 1;
  pausedTabs: number[];
  pausedSites: TemporarySitePause[];
};

export type TemporaryResolution = {
  tabPaused: boolean;
  sitePause: TemporarySitePause | null;
};

export type PageScannerState =
  | 'loading'
  | 'active'
  | 'global_disabled'
  | 'excluded'
  | 'tab_paused'
  | 'site_paused'
  | 'safety_stopped';

const PAGE_SCANNER_STATES = new Set<PageScannerState>([
  'loading',
  'active',
  'global_disabled',
  'excluded',
  'tab_paused',
  'site_paused',
  'safety_stopped',
]);

export type PageStatus = {
  available: true;
  hostname: string;
  state: PageScannerState;
  hiddenCount: number;
  tabPaused: boolean;
  sitePause: TemporarySitePause | null;
  excludedBy: string | null;
};

export type UnavailablePageStatus = {
  available: false;
  hostname: string | null;
  reason: string;
};

export type PopupPageStatus = PageStatus | UnavailablePageStatus;

export type TemporaryControlCommand =
  | { type: 'temporary.get'; hostname: string; tabId?: number }
  | { type: 'temporary.tab.set'; hostname: string; tabId: number }
  | { type: 'temporary.tab.clear'; hostname: string; tabId: number }
  | { type: 'temporary.site.set'; hostname: string; duration: 'ten_minutes' | 'session'; tabId?: number }
  | { type: 'temporary.site.clear'; hostname: string; tabId?: number };

export type TemporaryControlResponse =
  | { ok: true; resolution: TemporaryResolution; message?: string }
  | { ok: false; error: string };

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isTemporarySitePause(value: unknown): value is TemporarySitePause {
  if (!isRecord(value)
    || typeof value['hostname'] !== 'string'
    || typeof value['createdAt'] !== 'number'
    || !Number.isFinite(value['createdAt'])
    || (value['expiresAt'] !== null
      && (typeof value['expiresAt'] !== 'number' || !Number.isFinite(value['expiresAt'])))) {
    return false;
  }
  try {
    return normalizePageHostname(value['hostname']) === value['hostname'];
  } catch {
    return false;
  }
}

export function isTemporaryResolution(value: unknown): value is TemporaryResolution {
  return isRecord(value)
    && typeof value['tabPaused'] === 'boolean'
    && (value['sitePause'] === null || isTemporarySitePause(value['sitePause']));
}

export function isPageStatus(value: unknown): value is PageStatus {
  if (!isRecord(value)
    || value['available'] !== true
    || typeof value['hostname'] !== 'string'
    || !PAGE_SCANNER_STATES.has(value['state'] as PageScannerState)
    || typeof value['hiddenCount'] !== 'number'
    || !Number.isInteger(value['hiddenCount'])
    || value['hiddenCount'] < 0
    || typeof value['tabPaused'] !== 'boolean'
    || !(value['excludedBy'] === null || typeof value['excludedBy'] === 'string')) {
    return false;
  }
  return isTemporaryResolution({
    tabPaused: value['tabPaused'],
    sitePause: value['sitePause'],
  });
}

export function normalizePageHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!normalized || normalized.length > 253 || /[\s/*]/.test(normalized)) {
    throw new Error('The current page does not have a valid hostname.');
  }
  return normalized;
}

export function createTemporaryControlState(): TemporaryControlState {
  return { version: TEMPORARY_CONTROL_VERSION, pausedTabs: [], pausedSites: [] };
}

export function validateTemporaryControlState(input: unknown): TemporaryControlState {
  if (!isRecord(input) || input['version'] !== TEMPORARY_CONTROL_VERSION) {
    return createTemporaryControlState();
  }
  const pausedTabs = Array.isArray(input['pausedTabs'])
    ? Array.from(new Set(input['pausedTabs'].filter(validTabId)))
    : [];
  const pausedSites: TemporarySitePause[] = [];
  const seen = new Set<string>();
  if (Array.isArray(input['pausedSites'])) {
    for (const raw of input['pausedSites']) {
      if (!isRecord(raw) || typeof raw['hostname'] !== 'string') continue;
      try {
        const hostname = normalizePageHostname(raw['hostname']);
        if (seen.has(hostname)) continue;
        const createdAt = typeof raw['createdAt'] === 'number' && Number.isFinite(raw['createdAt'])
          ? raw['createdAt']
          : Date.now();
        const expiresAt = raw['expiresAt'] === null
          ? null
          : typeof raw['expiresAt'] === 'number' && Number.isFinite(raw['expiresAt'])
            ? raw['expiresAt']
            : null;
        seen.add(hostname);
        pausedSites.push({ hostname, createdAt, expiresAt });
      } catch {
        continue;
      }
    }
  }
  return { version: TEMPORARY_CONTROL_VERSION, pausedTabs, pausedSites };
}

export function pruneExpiredPauses(
  state: TemporaryControlState,
  now = Date.now(),
): { state: TemporaryControlState; changed: boolean } {
  const pausedSites = state.pausedSites.filter((pause) => pause.expiresAt === null || pause.expiresAt > now);
  return {
    state: pausedSites.length === state.pausedSites.length ? state : { ...state, pausedSites },
    changed: pausedSites.length !== state.pausedSites.length,
  };
}

export function resolveTemporaryControl(
  state: TemporaryControlState,
  tabId: number | undefined,
  hostname: string,
  now = Date.now(),
): TemporaryResolution {
  const pruned = pruneExpiredPauses(state, now).state;
  const normalized = normalizePageHostname(hostname);
  const sitePause = pruned.pausedSites
    .filter((pause) => hostnameMatches(normalized, pause.hostname))
    .sort((left, right) => right.hostname.length - left.hostname.length)[0] ?? null;
  return {
    tabPaused: tabId !== undefined && pruned.pausedTabs.includes(tabId),
    sitePause,
  };
}

export function setTabPause(state: TemporaryControlState, tabId: number): TemporaryControlState {
  if (state.pausedTabs.includes(tabId)) return state;
  return { ...state, pausedTabs: [...state.pausedTabs, tabId] };
}

export function clearTabPause(state: TemporaryControlState, tabId: number): TemporaryControlState {
  const pausedTabs = state.pausedTabs.filter((candidate) => candidate !== tabId);
  return pausedTabs.length === state.pausedTabs.length ? state : { ...state, pausedTabs };
}

export function setSitePause(
  state: TemporaryControlState,
  hostname: string,
  duration: 'ten_minutes' | 'session',
  now = Date.now(),
): TemporaryControlState {
  const normalized = normalizePageHostname(hostname);
  const pause: TemporarySitePause = {
    hostname: normalized,
    createdAt: now,
    expiresAt: duration === 'ten_minutes' ? now + TEN_MINUTES_MS : null,
  };
  return {
    ...state,
    pausedSites: [...state.pausedSites.filter((candidate) => candidate.hostname !== normalized), pause],
  };
}

export function clearSitePause(state: TemporaryControlState, hostname: string): TemporaryControlState {
  const normalized = normalizePageHostname(hostname);
  const pausedSites = state.pausedSites.filter((candidate) => candidate.hostname !== normalized);
  return pausedSites.length === state.pausedSites.length ? state : { ...state, pausedSites };
}

export function isTemporaryControlCommand(value: unknown): value is TemporaryControlCommand {
  if (!isRecord(value) || typeof value['type'] !== 'string' || typeof value['hostname'] !== 'string') return false;
  switch (value['type']) {
    case 'temporary.get':
      return value['tabId'] === undefined || validTabId(value['tabId']);
    case 'temporary.tab.set':
    case 'temporary.tab.clear':
      return validTabId(value['tabId']);
    case 'temporary.site.set':
      return (value['duration'] === 'ten_minutes' || value['duration'] === 'session')
        && (value['tabId'] === undefined || validTabId(value['tabId']));
    case 'temporary.site.clear':
      return value['tabId'] === undefined || validTabId(value['tabId']);
    default:
      return false;
  }
}

export function isPageStatusRequest(value: unknown): value is { type: 'page.status.get' } {
  return isRecord(value) && value['type'] === 'page.status.get';
}

export function isPageControlApply(value: unknown): value is { type: 'page.control.apply'; resolution: TemporaryResolution } {
  return isRecord(value)
    && value['type'] === 'page.control.apply'
    && isTemporaryResolution(value['resolution']);
}
