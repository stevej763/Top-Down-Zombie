import { KeepAwake } from '@capacitor-community/keep-awake';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { StatusBar } from '@capacitor/status-bar';
import type { Game } from '../../client/src/core/Game';
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
