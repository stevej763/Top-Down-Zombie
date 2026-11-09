import { Game, VIEW_H, VIEW_W } from '../../client/src/core/Game';
import { fetchMap, fetchMaps } from '../../client/src/net/api';
import { Connection } from '../../client/src/net/Connection';
import { controlText } from '../../client/src/ui/keys';
import { setupNative } from './native';
import { TouchInput } from './TouchInput';

const DEFAULT_MAP = 'house';

// The shared UI's wording for the on-screen buttons (see controls.ts).
Object.assign(controlText, {
  press: 'Tap USE',
  hold: 'Hold USE',
  reload: 'Tap R to reload',
  confirm: 'Tap',
  toMenu: 'MENU for main menu',
  menuHints: false,
  controls: [
    ['Left thumb', 'Move'],
    ['Right thumb', 'Aim  (push far to shoot)'],
    ['R', 'Reload'],
    ['USE', 'Buy / use  (hold to rebuild)'],
    ['KNIFE', 'Knife  (auto when out of ammo)'],
    ['SWAP', 'Switch weapon'],
    ['II', 'Pause'],
  ],
});

const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.width = VIEW_W;
canvas.height = VIEW_H;

function fit(): void {
  const scale = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  canvas.style.width = `${Math.floor(VIEW_W * scale)}px`;
  canvas.style.height = `${Math.floor(VIEW_H * scale)}px`;
}
window.addEventListener('resize', fit);
fit();

const input = new TouchInput(
  canvas,
  document.getElementById('touch') as HTMLCanvasElement,
  document.getElementById('keyboard') as HTMLInputElement,
  document.getElementById('safe') as HTMLElement,
);

function drawLoop(): void {
  input.draw();
  requestAnimationFrame(drawLoop);
}

/** Maps come from the server, so the game can't start without it. */
async function boot(): Promise<void> {
  try {
    const maps = await fetchMaps();
    const first = maps.find((m) => m.id === DEFAULT_MAP) ?? maps[0];
    if (!first) throw new Error('The server has no maps');
    const game = new Game(canvas, maps, await fetchMap(first.id), new Connection(), input);
    game.showCrosshair = false;
    input.attach(game);
    setupNative(game, input);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && game.state === 'playing') game.pause();
    });
    game.start();
    drawLoop();
  } catch (e) {
    console.error(e);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e05050';
    ctx.font = '24px monospace';
    ctx.fillText("Can't reach the game server", VIEW_W / 2, VIEW_H / 2 - 14);
    ctx.fillStyle = '#9a9a9a';
    ctx.font = '15px monospace';
    ctx.fillText('Tap to try again', VIEW_W / 2, VIEW_H / 2 + 20);
    window.addEventListener('touchend', () => location.reload(), { once: true });
    window.addEventListener('click', () => location.reload(), { once: true });
  }
}

void boot();
