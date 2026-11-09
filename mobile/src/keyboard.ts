/**
 * Brings up the phone's keyboard for the menu's text fields (name, room code). The canvas can't take
 * focus, so an invisible <input> does, and what's typed into it is fed to the game as if from keys.
 * It holds one sentinel character so a Backspace always has something to delete and shows up as an
 * `input` event, whatever the keyboard.
 */
const SENTINEL = ' ';

export interface KeySink {
  typeText(text: string): void;
  tapKey(code: string): void;
}

export class Keyboard {
  constructor(private el: HTMLInputElement, sink: KeySink) {
    el.value = SENTINEL;
    el.addEventListener('input', () => {
      const v = el.value;
      if (v.length < SENTINEL.length) sink.tapKey('Backspace');
      else if (v.length > SENTINEL.length) sink.typeText(v.slice(SENTINEL.length));
      el.value = SENTINEL;
    });
    // Keep these from Input's window listener, which would type them a second time.
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        sink.tapKey('Enter');
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return document.activeElement === this.el;
  }

  /** Must run inside a touch handler: iOS only opens the keyboard for a user gesture. */
  open(): void {
    this.el.value = SENTINEL;
    if (!this.isOpen) this.el.focus();
  }

  close(): void {
    if (this.isOpen) this.el.blur();
  }
}
