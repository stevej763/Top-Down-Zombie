import { KeepAwake } from '@capacitor-community/keep-awake';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Network } from '@capacitor/network';
import { StatusBar } from '@capacitor/status-bar';
import type { Game } from '../../client/src/core/Game';
import { setNativeDevice } from '../../client/src/net/device';
import type { NetEvent } from '../../client/src/net/protocol';
import type { TouchInput } from './TouchInput';

/** How hard to buzz for your own events; anything else stays still. */
function buzz(e: NetEvent): ImpactStyle | null {
  switch (e.type) {
    case 'playerDowned': return ImpactStyle.Heavy;
    case 'playerHurt': return ImpactStyle.Medium;
    case 'weaponGiven': case 'perkBought': case 'armourBought': case 'upgraded': case 'ammoBought': case 'powerUp':
      return ImpactStyle.Light;
    default: return null;
  }
}

/** Phone-only glue. In a mobile browser (no Capacitor) this does nothing. */
export function setupNative(game: Game, input: TouchInput): void {
  if (!Capacitor.isNativePlatform()) return;
  const quiet = () => {};
  StatusBar.hide().catch(quiet);
  KeepAwake.keepAwake().catch(quiet);
  // A WebView doesn't reliably blur when the app goes to the background.
  void App.addListener('pause', () => {
    if (game.state === 'playing') game.pause();
  });
  // Android's back button works like Esc: pause in play, back out of menus.
  void App.addListener('backButton', () => input.tapKey('Escape'));
  game.eventHook = (e) => {
    if (!('player' in e) || e.player !== game.you) return;
    const style = buzz(e);
    if (style) Haptics.impact({ style }).catch(quiet);
  };
}

/**
 * Tells the heartbeat's device report what the WebView's user agent can't: the exact model (iOS
 * only says "iPhone", and an iPad claims to be a Mac), the OS and WebView versions, the app's
 * version, and wifi or cellular. Call before `game.start()`; on failure the report falls back to
 * the user agent.
 */
export async function describeDevice(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const [info, { identifier }, app] = await Promise.all([Device.getInfo(), Device.getId(), App.getInfo()]);
    let network: string | null = null;
    Network.getStatus().then((s) => (network = s.connectionType), () => {});
    void Network.addListener('networkStatusChange', (s) => (network = s.connectionType));
    const ios = info.operatingSystem === 'ios';
    const ipad = ios && info.model.startsWith('iPad');
    setNativeDevice({
      // identifierForVendor / ANDROID_ID outlive the WebView's storage, which iOS may clear.
      deviceId: identifier || undefined,
      os: `${ipad ? 'iPadOS' : ios ? 'iOS' : 'Android'} ${info.osVersion}`,
      browser: `WebView ${info.webViewVersion}`,
      model: info.model.toLowerCase().startsWith(info.manufacturer.toLowerCase())
        ? info.model : `${info.manufacturer} ${info.model}`,
      details: () => ({
        appVersion: `${app.version} (${app.build})`,
        androidSdk: info.androidSDKVersion ?? null,
        emulator: info.isVirtual,
        network,
      }),
    });
  } catch {
    // Plugins missing (an old native build): the user agent will do.
  }
}
