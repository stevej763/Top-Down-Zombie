const GAME_KEYS = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
]);

/** Keyboard + mouse state. `pressed` flags last until the end of the next fixed update tick. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  /** Mouse position in canvas (view) coordinates. */
  readonly mouse = { x: 0, y: 0 };
  mouseDown = false;
  mousePressed = false;
  wheel = 0;
  /** Printable characters typed this tick, for text fields. */
  typed = '';

  constructor(private canvas: HTMLCanvasElement, private viewW: number, private viewH: number) {
    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) this.typed += e.key;
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('mousemove', (e) => this.updateMouse(e));
    canvas.addEventListener('mousedown', (e) => {
      this.updateMouse(e);
      if (e.button === 0) {
        this.mouseDown = true;
        this.mousePressed = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouseDown = false;
    });
  }

  private updateMouse(e: MouseEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) * this.viewW) / r.width;
    this.mouse.y = ((e.clientY - r.top) * this.viewH) / r.height;
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  endTick(): void {
    this.pressed.clear();
    this.mousePressed = false;
    this.wheel = 0;
    this.typed = '';
  }
}
