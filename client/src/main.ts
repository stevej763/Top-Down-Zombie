import { Game, VIEW_H, VIEW_W } from './core/Game';
import { fetchMap, fetchMaps } from './net/api';
import { Connection } from './net/Connection';

const DEFAULT_MAP = 'house';

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

/** Maps come from the server, so the game can't start without it. */
async function boot(): Promise<void> {
  try {
    const maps = await fetchMaps();
    const first = maps.find((m) => m.id === DEFAULT_MAP) ?? maps[0];
    if (!first) throw new Error('The server has no maps');
    new Game(canvas, maps, await fetchMap(first.id), new Connection()).start();
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
    ctx.fillText('Reload to try again', VIEW_W / 2, VIEW_H / 2 + 20);
  }
}

void boot();
