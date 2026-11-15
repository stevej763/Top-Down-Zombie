import { loadStored } from '../core/storage';

/** What the heartbeat says about this device, for the admin portal. Mirrors Java `PlayerActivity.DeviceReport`. */
export interface DeviceReport {
  deviceId: string;
  platform: 'web' | 'ios' | 'android';
  os: string | null;
  browser: string | null;
  model: string | null;
  details: Record<string, string | number | boolean | null>;
}

const DEVICE_KEY = 'top-down-survival-device';

/** A random id kept in localStorage, so one browser or phone is one device across names and sessions. */
function deviceId(): string {
  let id = loadStored(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try {
      localStorage.setItem(DEVICE_KEY, id);
    } catch {
      // Storage unavailable: a new device each session.
    }
  }
  return id;
}

/** Capacitor injects this global into the app's WebView; a plain browser has none. */
function platform(): DeviceReport['platform'] {
  const p = (globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
  return p === 'ios' || p === 'android' ? p : 'web';
}

function osOf(ua: string): string | null {
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/))) return `iOS ${m[1]}.${m[2]}`;
  if ((m = ua.match(/Android (\d+(?:\.\d+)?)/))) return `Android ${m[1]}`;
  if ((m = ua.match(/Windows NT (\d+\.\d+)/))) return m[1] === '10.0' ? 'Windows 10/11' : `Windows NT ${m[1]}`;
  if ((m = ua.match(/Mac OS X (\d+)[_.](\d+)/))) return `macOS ${m[1]}.${m[2]}`;
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

function browserOf(ua: string): string | null {
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/Edg(?:A|iOS)?\/(\d+)/))) return `Edge ${m[1]}`;
  if ((m = ua.match(/OPR\/(\d+)/))) return `Opera ${m[1]}`;
  if ((m = ua.match(/SamsungBrowser\/(\d+)/))) return `Samsung Internet ${m[1]}`;
  if ((m = ua.match(/(?:Firefox|FxiOS)\/(\d+)/))) return `Firefox ${m[1]}`;
  if ((m = ua.match(/(?:Chrome|CriOS)\/(\d+)/))) return `Chrome ${m[1]}`;
  if ((m = ua.match(/Version\/(\d+(?:\.\d+)?).*Safari/))) return `Safari ${m[1]}`;
  if (/AppleWebKit/.test(ua)) return 'WebView';
  return null;
}

/** Android UAs name the model ("; Pixel 8 Build/" or "; SM-S918B)"); iOS only says iPhone or iPad. */
function modelOf(ua: string): string | null {
  const m = ua.match(/Android [^;)]*;\s*([^;)]+?)(?:\s+Build\/|\))/);
  if (m && m[1] !== 'K') return m[1].trim();
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  return null;
}

let cached: DeviceReport | null = null;

export function deviceReport(): DeviceReport {
  const ua = navigator.userAgent;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string } };
  cached ??= { deviceId: deviceId(), platform: platform(), os: osOf(ua), browser: browserOf(ua), model: modelOf(ua), details: {} };
  // The rest can change while the app is open (rotation, window size, network).
  cached.details = {
    screen: `${screen.width}x${screen.height}`,
    pixelRatio: Math.round(devicePixelRatio * 100) / 100,
    viewport: `${innerWidth}x${innerHeight}`,
    language: navigator.language ?? null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    cores: navigator.hardwareConcurrency ?? null,
    memoryGb: nav.deviceMemory ?? null,
    touch: navigator.maxTouchPoints > 0,
    network: nav.connection?.effectiveType ?? null,
    standalone: matchMedia('(display-mode: standalone)').matches,
  };
  return cached;
}
