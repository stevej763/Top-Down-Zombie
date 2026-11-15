import { sound, type VolumeChannel } from '../audio/Sound';
import { VIEW_H, VIEW_W, type Game } from '../core/Game';
import {
  canPlay, changePassword, isAccount, loadIdentity, login, logout, NAME_MAX, needsLogin, needsVerifying, register, resendCode,
  setName, unlocked, validName, verifyEmail, type Outcome,
} from '../net/api';
import { MAX_SCORES } from '../systems/HighScore';
import { controlText } from './keys';
import { DISPLAY_FONT, shadowText } from './text';

/** Title menu and pause menu: pages of buttons/sliders driven by keyboard or mouse. */

type Page = 'main' | 'scores' | 'audio' | 'controls' | 'name' | 'maps' | 'mode' | 'join' | 'lobby'
  | 'welcome' | 'login' | 'register' | 'account' | 'password' | 'verify';
/** Where to carry on once the player has a name or has signed in. */
type Then = 'play' | 'join' | 'mode' | 'main' | 'account';
/** What a text field holds, so the phone can bring up the right keyboard. */
export type TextKind = 'text' | 'email' | 'password' | 'code';
export type MenuMode = 'title' | 'pause';

type Item =
  | { type: 'button'; label: string; run: () => void; dim?: boolean }
  | { type: 'slider'; label: string; get: () => number; set: (v: number) => void }
  | { type: 'toggle'; label: string; get: () => boolean; set: (v: boolean) => void }
  | { type: 'text'; label: string; max: number; get: () => string; set: (v: string) => void; submit: () => void; kind?: TextKind };

interface Rect { x: number; y: number; w: number; h: number }

/** Where each page's item column starts, and row spacing. */
const LAYOUT: Record<Page, { y: number; step: number; w: number }> = {
  main: { y: 270, step: 44, w: 300 },
  audio: { y: 180, step: 54, w: 560 },
  scores: { y: 515, step: 0, w: 240 },
  controls: { y: 515, step: 0, w: 240 },
  name: { y: 250, step: 56, w: 440 },
  maps: { y: 200, step: 52, w: 300 },
  mode: { y: 230, step: 52, w: 300 },
  join: { y: 250, step: 56, w: 440 },
  lobby: { y: 430, step: 52, w: 300 },
  welcome: { y: 250, step: 52, w: 300 },
  login: { y: 200, step: 56, w: 520 },
  register: { y: 200, step: 56, w: 520 },
  account: { y: 240, step: 52, w: 300 },
  password: { y: 220, step: 56, w: 520 },
  verify: { y: 220, step: 52, w: 300 },
};
const EMAIL_MAX = 254;
/** PlayerAccounts.MAX_PASSWORD_BYTES; the server has the final say on length. */
const PASSWORD_MAX = 72;
/** Room codes: 4 letters, without I, L or O (LobbyService.CODE_LETTERS). */
const CODE_LENGTH = 4;
const CODE_FILTER = /[^A-HJKMNP-Z]/g;
/** The emailed code: EmailVerification's 6 digits. */
const VERIFY_LENGTH = 6;
const VERIFY_FILTER = /\D/g;
const PAUSE_MAIN_Y = 230;
const ROW_H = 42;
const BUTTON_MAX_W = 300;
/** Slider track span inside a row: offset from the left edge and inset from the right. */
const TRACK_LEFT = 200;
const TRACK_RIGHT = 90;
const SLIDER_STEP = 0.1;

const TITLES: Record<Page, string> = {
  main: 'PAUSED', scores: 'HIGH SCORES', audio: 'AUDIO', controls: 'CONTROLS', name: 'YOUR NAME', maps: 'CHOOSE MAP',
  mode: 'NEW GAME', join: 'JOIN GAME', lobby: 'LOBBY', welcome: 'WELCOME', login: 'LOG IN', register: 'CREATE ACCOUNT',
  account: 'ACCOUNT', password: 'PASSWORD', verify: 'VERIFY EMAIL',
};

export class Menu {
  mode: MenuMode = 'title';
  page: Page = 'main';
  private index = 0;
  /** Main-page selection to restore when backing out of a sub-page. */
  private mainIndex = 0;
  private lastMouse = { x: -1, y: -1 };
  private nameDraft = '';
  private codeDraft = '';
  private emailDraft = '';
  private passDraft = '';
  private newPassDraft = '';
  private verifyDraft = '';
  /** Where the name, login and register pages carry on to once they're done. */
  private then: Then = 'main';
  /** The page that login and register go back to. */
  private returnPage: Page = 'main';
  /** Why the register page was opened (a locked map, co-op), shown above the form. */
  private reason = '';
  private notice = '';
  /** The notice is good news (code sent, password changed), not a problem. */
  private noticeOk = false;
  /** Waiting for the server to answer a create or join; ignore further picks. */
  private loading = false;
  /** Waiting for the server to answer a login, signup, rename or password change. */
  private busy = false;
  /** High scores: the map arrow under the pointer (0 left, 1 right, -1 none), and when each was last used. */
  private arrowHover = -1;
  private arrowUsedAt = [0, 0];

  open(mode: MenuMode): void {
    this.mode = mode;
    this.page = 'main';
    this.index = this.mainIndex = 0;
  }

  /** The server refused something (or the connection was lost); show why. */
  fail(message: string): void {
    this.notice = message;
    this.noticeOk = false;
    this.loading = false;
    sound.denied();
  }

  /** The server answered the create or join. */
  done(): void {
    this.loading = false;
    this.notice = '';
  }

  showLobby(): void {
    this.go('lobby');
  }

  private go(page: Page): void {
    if (this.page === 'main') this.mainIndex = this.index;
    this.page = page;
    this.index = page === 'main' ? this.mainIndex : 0;
    this.notice = '';
    this.noticeOk = false;
  }

  private tell(message: string): void {
    this.notice = message;
    this.noticeOk = true;
  }

  /** New Game: guest or account the first time, then pick a map if there's a choice, then solo or co-op. */
  private startRun(game: Game): void {
    if (!loadIdentity()) this.openWelcome('play');
    else if (needsLogin()) this.openLogin('play', 'main');
    else this.afterName(game);
  }

  private openWelcome(then: Then): void {
    this.then = then;
    this.go('welcome');
  }

  private openLogin(then: Then, back: Page): void {
    this.then = then;
    this.returnPage = back;
    this.emailDraft = loadIdentity()?.email ?? this.emailDraft;
    this.passDraft = '';
    this.go('login');
    if (needsLogin()) this.notice = 'Signed out on this device. Log in again';
  }

  /** `reason` says what an account would unlock, when a guest hit a lock. */
  private openRegister(then: Then, back: Page, reason = ''): void {
    this.then = then;
    this.returnPage = back;
    this.reason = reason;
    const id = loadIdentity();
    this.nameDraft = id && !id.account ? id.name : '';
    this.passDraft = '';
    this.go('register');
  }

  /** The code was mailed at signup; `reason` says what verifying would unlock, when they hit a lock. */
  private openVerify(then: Then, back: Page, reason = ''): void {
    this.then = then;
    this.returnPage = back;
    this.reason = reason;
    this.verifyDraft = '';
    this.go('verify');
  }

  /** A guest or unverified account hit a lock: the page that lifts it, saying what it unlocks ("play online"). */
  private unlock(then: Then, back: Page, what: string): void {
    if (needsVerifying()) this.openVerify(then, back, `Verify your email to ${what}`);
    else this.openRegister(then, back, `Create a free account to ${what}`);
  }

  /** Signed up or in: an unverified account is asked for its code first (it can skip that). */
  private signedIn(game: Game): void {
    this.passDraft = '';
    if (needsVerifying()) this.openVerify(this.then, this.returnPage, this.reason);
    else this.proceed(game);
  }

  /** Carry on to wherever the player was heading before they named themselves or signed in. */
  private proceed(game: Game): void {
    switch (this.then) {
      case 'play': this.afterName(game); break;
      case 'join': this.openJoin(); break;
      case 'mode': this.go('mode'); break;
      case 'account': this.go('account'); break;
      default: this.go('main');
    }
  }

  /** Runs an account call, showing its error or carrying on. */
  private account(game: Game, call: () => Promise<Outcome>, then: () => void): void {
    if (this.busy) return;
    this.busy = true;
    this.notice = 'Talking to the server…';
    void call().then((error) => {
      this.busy = false;
      if (error) {
        this.fail(error);
        return;
      }
      game.identityChanged();
      then();
    });
  }

  private submitLogin(game: Game): void {
    if (!this.emailDraft.trim() || !this.passDraft) {
      this.fail('Type your email and password');
      return;
    }
    this.account(game, () => login(this.emailDraft, this.passDraft), () => this.signedIn(game));
  }

  private submitRegister(game: Game): void {
    const name = this.nameDraft.trim();
    if (!this.emailDraft.trim() || !name || !this.passDraft) {
      this.fail('Fill in every field');
      return;
    }
    if (!validName(name)) {
      this.fail("Usernames: letters, numbers, spaces and . _ ' - only");
      return;
    }
    this.account(game, () => register(this.emailDraft, name, this.passDraft), () => this.signedIn(game));
  }

  private submitVerify(game: Game): void {
    if (this.verifyDraft.length !== VERIFY_LENGTH) {
      this.fail(`Type the ${VERIFY_LENGTH}-digit code from the email`);
      return;
    }
    this.account(game, () => verifyEmail(this.verifyDraft), () => {
      this.verifyDraft = '';
      this.proceed(game);
      this.tell('Email verified');
    });
  }

  private resend(game: Game): void {
    this.account(game, resendCode, () => this.tell('Sent a new code'));
  }

  private submitPassword(game: Game): void {
    if (!this.passDraft || !this.newPassDraft) {
      this.fail('Type both passwords');
      return;
    }
    this.account(game, () => changePassword(this.passDraft, this.newPassDraft), () => {
      this.passDraft = this.newPassDraft = '';
      this.go('account');
      this.tell('Password changed');
    });
  }

  private logOut(game: Game): void {
    void logout();
    this.emailDraft = '';
    game.identityChanged();
    this.go('main');
  }

  /** Guests hit a lock on co-op and on maps other than the guest maps. */
  private playSolo(game: Game): void {
    const map = game.maps.find((m) => m.id === game.mapId);
    if (!canPlay(map, true)) this.unlock('mode', 'mode', `play ${map?.name ?? game.mapId}`);
    else this.request(() => game.createRoom(true));
  }

  private hostCoop(game: Game): void {
    if (!unlocked()) this.unlock('mode', 'mode', 'play online');
    else this.request(() => game.createRoom(false));
  }

  private afterName(game: Game): void {
    if (game.maps.length <= 1) {
      this.go('mode');
      return;
    }
    this.go('maps');
    this.index = Math.max(0, game.maps.findIndex((m) => m.id === game.mapId));
  }

  private chooseMap(game: Game, id: string): void {
    game.selectMap(id);
    const map = game.maps.find((m) => m.id === id);
    if (!canPlay(map, true)) this.unlock('mode', 'maps', `play ${map?.name ?? id}`);
    else this.go('mode');
  }

  private openJoin(): void {
    if (needsLogin()) {
      this.openLogin('join', 'main');
      return;
    }
    if (!unlocked()) {
      this.unlock('join', 'main', 'play online');
      return;
    }
    this.codeDraft = '';
    this.go('join');
  }

  /** Ask the server for a room; `welcome` (or an error) ends the wait. */
  private request(run: () => void): void {
    if (this.loading) return;
    this.loading = true;
    this.notice = 'Connecting…';
    run();
  }

  private submitCode(game: Game): void {
    if (this.codeDraft.length !== CODE_LENGTH) {
      this.fail(`Codes are ${CODE_LENGTH} letters`);
      return;
    }
    this.request(() => game.joinRoom(this.codeDraft));
  }

  /** Esc or Back out of a page that may hold a room (or be waiting for one). */
  private leave(game: Game): void {
    if (this.loading || this.page === 'lobby') game.leaveRoom();
    this.loading = false;
    this.go('main');
  }

  private cycleScoresMap(game: Game, dir: number): void {
    const n = game.maps.length;
    if (n <= 1) return;
    const i = game.maps.findIndex((m) => m.id === game.scores.mapId);
    game.scores.show(game.maps[(i + dir + n) % n].id);
    this.arrowUsedAt[dir < 0 ? 0 : 1] = performance.now();
    sound.menuMove();
  }

  private openScores(game: Game): void {
    this.go('scores');
    game.scores.prefetch(game.maps.map((m) => m.id));
    game.scores.show(game.mapId);
  }

  private openName(then: Then): void {
    this.nameDraft = loadIdentity()?.name ?? '';
    this.then = then;
    this.go('name');
  }

  private submitName(game: Game): void {
    const name = this.nameDraft.trim();
    if (!validName(name)) {
      this.notice = name ? "Letters, numbers, spaces and . _ ' - only" : 'Type a name first';
      sound.denied();
      return;
    }
    // Offline, the name is kept locally and registered when connecting; a name an account owns is refused.
    this.account(game, () => setName(name), () => this.proceed(game));
  }

  /** The page Esc and Back return to. */
  private parent(): Page {
    switch (this.page) {
      case 'name': return this.then === 'account' ? 'account' : this.then === 'main' ? 'main' : 'welcome';
      case 'login':
      case 'register':
      case 'verify': return this.returnPage;
      case 'password': return 'account';
      default: return 'main';
    }
  }

  /** The kind of text field selected, if any (the phone keyboard to show). */
  selectedTextKind(game: Game): TextKind | null {
    const item = this.items(game)[this.index];
    return item?.type === 'text' ? item.kind ?? 'text' : null;
  }

  /**
   * The text field a tap at this point would type into, if any: the one under it, or the selected
   * one when the tap misses every item (so the phone keyboard comes up).
   */
  textKindAt(game: Game, p: { x: number; y: number }): TextKind | null {
    const items = this.items(game);
    const i = this.rects(items).findIndex((r) => inside(p, r));
    const item = items[i < 0 ? this.index : i];
    return item?.type === 'text' ? item.kind ?? 'text' : null;
  }

  private items(game: Game): Item[] {
    const back: Item = { type: 'button', label: 'Back', run: () => this.go(this.parent()) };
    const field = (label: string, max: number, kind: TextKind, get: () => string, set: (v: string) => void, submit: () => void): Item => ({
      type: 'text', label, max, kind, get, set: (v) => { set(v); this.notice = ''; }, submit,
    });
    const next = (): void => { this.index++; };
    const volume = (label: string, ch: VolumeChannel): Item => ({
      type: 'slider', label, get: () => sound.volume(ch), set: (v) => sound.setVolume(ch, v),
    });
    switch (this.page) {
      case 'main':
        return [
          this.mode === 'title'
            ? { type: 'button', label: 'New Game', run: () => this.startRun(game) }
            : { type: 'button', label: 'Resume', run: () => game.resume() },
          ...(this.mode === 'title'
            ? [
              { type: 'button', label: 'Join Game', run: () => this.openJoin() },
              { type: 'button', label: 'High Scores', run: () => this.openScores(game) },
              { type: 'button', label: 'Account', run: () => this.go('account') },
            ] as Item[]
            : []),
          { type: 'button', label: 'Audio', run: () => this.go('audio') },
          { type: 'button', label: 'Controls', run: () => this.go('controls') },
          ...(this.mode === 'pause' ? [{ type: 'button', label: 'Quit to Menu', run: () => game.toMenu() } as Item] : []),
        ];
      case 'audio':
        return [
          volume('Master', 'master'),
          volume('Music', 'music'),
          volume('Effects', 'sfx'),
          { type: 'toggle', label: 'Mute', get: () => sound.muted, set: () => sound.toggleMute() },
          { type: 'button', label: 'Next Track', run: () => sound.skipTrack() },
          back,
        ];
      case 'maps':
        return [
          ...game.maps.map((m): Item => {
            const locked = !canPlay(m, true);
            const label = locked ? `${m.name}  (${needsVerifying() ? 'verify email' : 'account'})` : m.name;
            return { type: 'button', label, dim: locked, run: () => this.chooseMap(game, m.id) };
          }),
          back,
        ];
      case 'mode':
        return [
          { type: 'button', label: 'Play Solo', run: () => this.playSolo(game) },
          { type: 'button', label: 'Host Co-op', dim: !unlocked(), run: () => this.hostCoop(game) },
          { type: 'button', label: 'Back', run: () => this.leave(game) },
        ];
      case 'join':
        return [
          {
            type: 'text', label: 'Code', max: CODE_LENGTH, get: () => this.codeDraft,
            set: (v) => { this.codeDraft = v.toUpperCase().replace(CODE_FILTER, ''); this.notice = ''; },
            submit: () => this.submitCode(game),
          },
          { type: 'button', label: 'Join', run: () => this.submitCode(game) },
          { type: 'button', label: 'Back', run: () => this.leave(game) },
        ];
      case 'lobby': {
        const me = game.lobbyMe;
        return [
          game.isHost
            ? { type: 'button', label: 'Start', run: () => game.startGame() }
            : { type: 'toggle', label: 'Ready', get: () => me?.ready ?? false, set: (v) => game.setReady(v) },
          { type: 'button', label: 'Leave', run: () => this.leave(game) },
        ];
      }
      case 'name':
        return [
          {
            type: 'text', label: 'Name', max: NAME_MAX, get: () => this.nameDraft,
            set: (v) => { this.nameDraft = v; this.notice = ''; }, submit: () => this.submitName(game),
          },
          { type: 'button', label: this.then === 'account' || this.then === 'main' ? 'Save' : 'Next', run: () => this.submitName(game) },
          back,
        ];
      case 'welcome':
        return [
          { type: 'button', label: 'Play as Guest', run: () => this.openName(this.then) },
          { type: 'button', label: 'Log In', run: () => this.openLogin(this.then, 'welcome') },
          { type: 'button', label: 'Create Account', run: () => this.openRegister(this.then, 'welcome') },
          back,
        ];
      case 'login':
        return [
          field('Email', EMAIL_MAX, 'email', () => this.emailDraft, (v) => { this.emailDraft = v.trim(); }, next),
          field('Password', PASSWORD_MAX, 'password', () => this.passDraft, (v) => { this.passDraft = v; }, () => this.submitLogin(game)),
          { type: 'button', label: 'Log In', run: () => this.submitLogin(game) },
          { type: 'button', label: 'Create Account', run: () => this.openRegister(this.then, this.returnPage, this.reason) },
          back,
        ];
      case 'register':
        return [
          field('Email', EMAIL_MAX, 'email', () => this.emailDraft, (v) => { this.emailDraft = v.trim(); }, next),
          field('Username', NAME_MAX, 'text', () => this.nameDraft, (v) => { this.nameDraft = v; }, next),
          field('Password', PASSWORD_MAX, 'password', () => this.passDraft, (v) => { this.passDraft = v; }, () => this.submitRegister(game)),
          { type: 'button', label: 'Create Account', run: () => this.submitRegister(game) },
          { type: 'button', label: 'I Have an Account', run: () => this.openLogin(this.then, this.returnPage) },
          back,
        ];
      case 'verify':
        return [
          {
            type: 'text', label: 'Code', max: VERIFY_LENGTH, kind: 'code', get: () => this.verifyDraft,
            set: (v) => { this.verifyDraft = v.replace(VERIFY_FILTER, ''); this.notice = ''; },
            submit: () => this.submitVerify(game),
          },
          { type: 'button', label: 'Verify', run: () => this.submitVerify(game) },
          { type: 'button', label: 'Send a New Code', run: () => this.resend(game) },
          { type: 'button', label: 'Later', run: () => this.proceed(game) },
        ];
      case 'password':
        return [
          field('Current', PASSWORD_MAX, 'password', () => this.passDraft, (v) => { this.passDraft = v; }, next),
          field('New', PASSWORD_MAX, 'password', () => this.newPassDraft, (v) => { this.newPassDraft = v; }, () => this.submitPassword(game)),
          { type: 'button', label: 'Save', run: () => this.submitPassword(game) },
          back,
        ];
      case 'account': {
        const signIn: Item = { type: 'button', label: 'Log In', run: () => this.openLogin('account', 'account') };
        const rename: Item = { type: 'button', label: 'Change Name', run: () => this.openName('account') };
        const out: Item = { type: 'button', label: 'Log Out', run: () => this.logOut(game) };
        if (needsLogin()) return [signIn, out, back];
        if (isAccount()) {
          const pw: Item = { type: 'button', label: 'Change Password', run: () => { this.passDraft = this.newPassDraft = ''; this.go('password'); } };
          const verify: Item = { type: 'button', label: 'Verify Email', run: () => this.openVerify('account', 'account') };
          return needsVerifying() ? [verify, rename, pw, out, back] : [rename, pw, out, back];
        }
        return [
          { type: 'button', label: 'Create Account', run: () => this.openRegister('account', 'account') },
          signIn,
          ...(loadIdentity() ? [rename] : []),
          back,
        ];
      }
      default:
        return [back];
    }
  }

  private rects(items: Item[]): Rect[] {
    const l = LAYOUT[this.page];
    const y0 = this.page === 'main' && this.mode === 'pause' ? PAUSE_MAIN_Y : l.y;
    return items.map((it, i) => {
      const w = it.type === 'button' ? Math.min(l.w, BUTTON_MAX_W) : l.w;
      return { x: (VIEW_W - w) / 2, y: y0 + i * l.step, w, h: ROW_H };
    });
  }

  update(game: Game): void {
    const inp = game.input;
    const items = this.items(game);
    const rects = this.rects(items);
    // While a text field is selected, letters and Backspace type instead of navigating.
    const typing = items[this.index].type === 'text';

    if (inp.wasPressed('Escape') || (!typing && inp.wasPressed('Backspace'))) {
      sound.menuMove();
      if (this.page === 'mode' || this.page === 'join' || this.page === 'lobby') this.leave(game);
      else if (this.page !== 'main') this.go(this.parent());
      else if (this.mode === 'pause') game.resume();
      return;
    }

    const down = typing ? inp.wasPressed('ArrowDown') : inp.wasPressed('ArrowDown', 'KeyS');
    const up = typing ? inp.wasPressed('ArrowUp') : inp.wasPressed('ArrowUp', 'KeyW');
    const step = (down ? 1 : 0) - (up ? 1 : 0);
    if (step) {
      this.index = (this.index + step + items.length) % items.length;
      sound.menuMove();
    }

    // Hover only steals the selection when the mouse actually moves, so a resting cursor doesn't fight the keys.
    const m = inp.mouse;
    const moved = m.x !== this.lastMouse.x || m.y !== this.lastMouse.y;
    this.lastMouse = { x: m.x, y: m.y };
    const hover = rects.findIndex((r) => inside(m, r));
    if (hover >= 0 && hover !== this.index && (moved || inp.mousePressed)) {
      this.index = hover;
      sound.menuMove();
    }

    if (this.page === 'scores') {
      // The arrows aren't menu items, so Back stays selected for Enter and Esc. Taps on mobile arrive as clicks.
      this.arrowHover = scoreArrows(game).findIndex((r) => inside(m, r));
      const click = inp.mousePressed && this.arrowHover >= 0 ? this.arrowHover * 2 - 1 : 0;
      const dir = click || (inp.wasPressed('ArrowRight', 'KeyD') ? 1 : 0) - (inp.wasPressed('ArrowLeft', 'KeyA') ? 1 : 0);
      if (dir) this.cycleScoresMap(game, dir);
    }

    const item = items[this.index];
    const r = rects[this.index];
    if (item.type === 'text') {
      // Only if it was already selected at the start of the tick, so the S that moved here isn't typed.
      if (typing) {
        if (inp.typed) item.set((item.get() + inp.typed).slice(0, item.max));
        if (inp.wasPressed('Backspace')) item.set(item.get().slice(0, -1));
      }
      if (inp.wasPressed('Enter')) {
        sound.menuSelect();
        item.submit();
      }
    } else if (item.type === 'slider') {
      const dir = (inp.wasPressed('ArrowRight', 'KeyD') ? 1 : 0) - (inp.wasPressed('ArrowLeft', 'KeyA') ? 1 : 0);
      if (dir) setSlider(item, item.get() + dir * SLIDER_STEP);
      if (inp.mouseDown && hover === this.index) {
        const x0 = r.x + TRACK_LEFT;
        setSlider(item, (m.x - x0) / (r.w - TRACK_LEFT - TRACK_RIGHT));
      }
    } else if (inp.wasPressed('Enter', 'Space') || (inp.mousePressed && hover === this.index)) {
      sound.menuSelect();
      if (item.type === 'button') item.run();
      else item.set(!item.get());
    }
  }

  draw(ctx: CanvasRenderingContext2D, game: Game): void {
    const items = this.items(game);
    const rects = this.rects(items);
    const cx = VIEW_W / 2;

    ctx.fillStyle = `rgba(0, 0, 0, ${this.mode === 'title' ? 0.72 : 0.62})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    vignette(ctx);

    if (this.page === 'main' && this.mode === 'title') {
      drawLogo(ctx, cx, 135);
      shadowText(ctx, 'Hold the house. Survive the rounds.', cx, 215, '16px monospace', '#c8c8c8', 'center', 'middle');
      const parts: string[] = [];
      const name = loadIdentity()?.name;
      if (name) parts.push(`Playing as ${name}${!isAccount() ? ' (guest)' : needsVerifying() ? ' (email not verified)' : ''}`);
      const best = game.scores.entries[0];
      if (best) {
        const who = best.name ? `${best.name}, ` : '';
        parts.push(`${game.scores.online ? 'Record' : 'Best'}: ${who}${plural(best.round, 'round')} · ${plural(best.kills, 'kill')}`);
      }
      if (parts.length) shadowText(ctx, parts.join('   ·   '), cx, 548, '15px monospace', '#a0a0a0', 'center', 'middle');
    } else {
      shadowText(ctx, TITLES[this.page], cx, this.page === 'main' ? 140 : this.page === 'scores' ? 78 : 95, `${this.page === 'main' ? 64 : 52}px ${DISPLAY_FONT}`, '#e0e0e0', 'center', 'middle');
    }
    if (this.page === 'scores') {
      const now = performance.now();
      drawScores(ctx, game, [0, 1].map((i) => i === this.arrowHover || now - this.arrowUsedAt[i] < ARROW_FLASH_MS));
    }
    else if (this.page === 'name') {
      shadowText(ctx, 'Shown on the online high scores.', cx, 200, '16px monospace', '#c8c8c8', 'center', 'middle');
    } else if (this.page === 'mode') {
      const map = game.maps.find((m) => m.id === game.mapId)?.name ?? game.mapId;
      shadowText(ctx, map, cx, 170, '18px monospace', '#c8c8c8', 'center', 'middle');
    } else if (this.page === 'join') {
      shadowText(ctx, 'Ask the host for their room code.', cx, 200, '16px monospace', '#c8c8c8', 'center', 'middle');
    } else if (this.page === 'welcome') {
      shadowText(ctx, 'Guests can play The House solo.', cx, 180, '16px monospace', '#c8c8c8', 'center', 'middle');
      shadowText(ctx, 'A free account unlocks every map and online co-op.', cx, 205, '16px monospace', '#c8c8c8', 'center', 'middle');
    } else if (this.page === 'register') {
      const id = loadIdentity();
      if (this.reason) shadowText(ctx, this.reason, cx, 145, '16px monospace', '#f2d15c', 'center', 'middle');
      const sub = id && !id.account ? 'Your scores come with you.' : 'Your username is shown in game and on the high scores.';
      shadowText(ctx, sub, cx, 170, '15px monospace', '#c8c8c8', 'center', 'middle');
    } else if (this.page === 'verify') {
      if (this.reason) shadowText(ctx, this.reason, cx, 145, '16px monospace', '#f2d15c', 'center', 'middle');
      const email = loadIdentity()?.email;
      shadowText(ctx, email ? `We emailed a code to ${email}.` : 'We emailed you a code.', cx, 172, '15px monospace', '#c8c8c8', 'center', 'middle');
    } else if (this.page === 'login') {
      shadowText(ctx, 'Log in to your account on this device.', cx, 160, '16px monospace', '#c8c8c8', 'center', 'middle');
    } else if (this.page === 'account') {
      drawAccount(ctx);
    } else if (this.page === 'lobby') {
      drawLobby(ctx, game);
    } else if (this.page === 'main' && this.mode === 'pause' && game.room && !game.room.solo) {
      shadowText(ctx, 'The game keeps running', cx, 190, '15px monospace', '#c8c8c8', 'center', 'middle');
    }
    const notice = this.loading && game.link.problem ? `${game.link.problem}. Retrying…` : this.notice;
    if (notice && rects.length) {
      const last = rects[rects.length - 1];
      const color = (this.loading && !game.link.problem) || this.busy || this.noticeOk ? '#c8c8c8' : '#e05050';
      shadowText(ctx, notice, cx, last.y + last.h + 36, '16px monospace', color, 'center', 'middle');
    }
    else if (this.page === 'controls') drawControls(ctx);
    else if (this.page === 'audio' && game.nowPlaying.title) {
      shadowText(ctx, `Now playing: ${game.nowPlaying.title}`, cx, 140, '14px monospace', '#9a9a9a', 'center', 'middle');
    }

    items.forEach((it, i) => drawItem(ctx, it, rects[i], i === this.index));

    const hint = !controlText.menuHints
      ? this.page === 'lobby' ? 'Share the code with your friends' : ''
      : this.page === 'audio'
      ? '↑↓ select   ←→ adjust   Enter toggle   Esc back'
      : this.page === 'name'
        ? 'Type your name   Enter confirm   Esc back'
        : this.page === 'login' || this.page === 'register' || this.page === 'password'
          ? 'Type   ↑↓ move   Enter next   Esc back'
        : this.page === 'join'
          ? 'Type the code   Enter join   Esc back'
        : this.page === 'verify'
          ? 'Type the code   Enter verify   Esc back'
        : this.page === 'lobby'
          ? 'Share the code with your friends   Esc leave'
        : this.page === 'scores' && game.maps.length > 1
          ? '←→ change map   Esc back'
        : this.page === 'main' && this.mode === 'title'
        ? '↑↓ select   Enter confirm'
        : '↑↓ select   Enter confirm   Esc back';
    shadowText(ctx, hint, cx, VIEW_H - 22, '13px monospace', '#7a7a7a', 'center', 'middle');
  }
}

function setSlider(item: Extract<Item, { type: 'slider' }>, raw: number): void {
  // Snap to 5% so dragging only ticks (and saves) on visible changes.
  const v = Math.min(1, Math.max(0, Math.round(raw * 20) / 20));
  if (v === item.get()) return;
  item.set(v);
  sound.menuMove();
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function vignette(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.65);
  g.addColorStop(0, 'rgba(0, 0, 0, 0)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

/** A nailed-on board, drawn centred at (x, y). */
function drawPlank(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, angle: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(-w / 2 + 5, -h / 2 + 5, w, h);
  ctx.fillStyle = '#4e3520';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = '#634429';
  ctx.fillRect(-w / 2, -h / 2, w, h * 0.5);
  ctx.strokeStyle = 'rgba(25, 14, 6, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const gy = -h / 2 + h * (0.25 + i * 0.25);
    ctx.moveTo(-w / 2 + 10 + i * 40, gy);
    ctx.lineTo(w / 2 - 30 - i * 25, gy + (i - 1) * 2);
  }
  ctx.stroke();
  ctx.fillStyle = '#8c8c8c';
  for (const nx of [-w / 2 + 16, w / 2 - 16]) {
    ctx.beginPath();
    ctx.arc(nx, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const LOGO = 'TOP DOWN SURVIVAL';
const LOGO_MAX_W = 760;

function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // Shrink to fit when Impact is missing and the wider fallback font is used.
  ctx.font = `92px ${DISPLAY_FONT}`;
  const size = Math.min(92, Math.floor((92 * LOGO_MAX_W) / ctx.measureText(LOGO).width));
  ctx.font = `${size}px ${DISPLAY_FONT}`;
  const w = ctx.measureText(LOGO).width;
  drawPlank(ctx, x - 6, y - 20, w + 50, 36, -0.04);
  drawPlank(ctx, x + 8, y + 24, w + 10, 34, 0.03);
  shadowText(ctx, LOGO, x, y, `${size}px ${DISPLAY_FONT}`, '#b01414', 'center', 'middle');
}

function drawItem(ctx: CanvasRenderingContext2D, it: Item, r: Rect, sel: boolean): void {
  ctx.fillStyle = sel ? 'rgba(140, 16, 16, 0.9)' : 'rgba(12, 12, 12, 0.72)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = sel ? '#e04848' : 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);

  const my = r.y + r.h / 2;
  const color = sel ? '#ffffff' : it.type === 'button' && it.dim ? '#767676' : '#c8c8c8';
  if (it.type === 'button') {
    shadowText(ctx, it.label, r.x + r.w / 2, my + 1, `24px ${DISPLAY_FONT}`, color, 'center', 'middle');
    return;
  }
  shadowText(ctx, it.label, r.x + 22, my + 1, `22px ${DISPLAY_FONT}`, color, 'left', 'middle');
  if (it.type === 'text') {
    const caret = sel && Math.floor(performance.now() / 500) % 2 === 0 ? '_' : ' ';
    ctx.font = `22px ${DISPLAY_FONT}`;
    const x = Math.max(r.x + 110, r.x + 22 + ctx.measureText(it.label).width + 18);
    const raw = it.kind === 'password' ? '•'.repeat(it.get().length) : it.get();
    // Long values show their end, where the typing is.
    ctx.font = 'bold 18px monospace';
    let shown = raw;
    while (shown.length && ctx.measureText(shown + caret).width > r.x + r.w - 18 - x) shown = shown.slice(1);
    shadowText(ctx, (shown.length < raw.length ? '…' + shown.slice(1) : shown) + caret, x, my, 'bold 18px monospace', '#ffffff', 'left', 'middle');
    return;
  }
  if (it.type === 'toggle') {
    const on = it.get();
    shadowText(ctx, on ? 'ON' : 'OFF', r.x + r.w - 22, my, 'bold 16px monospace', on ? '#f2d15c' : '#8a8a8a', 'right', 'middle');
    return;
  }
  const v = it.get();
  const tx = r.x + TRACK_LEFT;
  const tw = r.w - TRACK_LEFT - TRACK_RIGHT;
  ctx.fillStyle = '#262626';
  ctx.fillRect(tx, my - 4, tw, 8);
  ctx.fillStyle = sel ? '#f2d15c' : '#a03030';
  ctx.fillRect(tx, my - 4, tw * v, 8);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(tx + tw * v - 5, my - 11, 10, 22);
  shadowText(ctx, `${Math.round(v * 100)}%`, r.x + r.w - 22, my, 'bold 16px monospace', color, 'right', 'middle');
}

interface Column { x: number; label: string; align?: CanvasTextAlign }

const SCORE_TABLE = { x: 120, y: 160, w: 720, h: 335 };
const SCORE_ROW_H = 28;
const SCORE_COLS: Column[] = [
  { x: 160, label: '#' }, { x: 200, label: 'NAME', align: 'left' }, { x: 470, label: 'ROUNDS' },
  { x: 560, label: 'KILLS' }, { x: 660, label: 'POINTS' }, { x: 770, label: 'DATE' },
];
/** The map arrows either side of the table: tall, so they're easy to hit with a thumb. */
const SCORE_ARROW = { w: 56, h: 150, gap: 12 };
const ARROW_FLASH_MS = 150;

/** Hit areas for the previous/next map arrows (none with only one map); used by update and draw. */
function scoreArrows(game: Game): Rect[] {
  if (game.maps.length <= 1) return [];
  const { x, y, w, h } = SCORE_TABLE;
  const { w: aw, h: ah, gap } = SCORE_ARROW;
  const ay = y + (h - ah) / 2;
  return [{ x: x - gap - aw, y: ay, w: aw, h: ah }, { x: x + w + gap, y: ay, w: aw, h: ah }];
}

function inside(p: { x: number; y: number }, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function drawScores(ctx: CanvasRenderingContext2D, game: Game, lit: boolean[]): void {
  const board = game.scores;
  const { x, y: top, w, h } = SCORE_TABLE;
  const cx = VIEW_W / 2;
  const cols = SCORE_COLS;
  const mapName = game.maps.find((m) => m.id === board.mapId)?.name ?? board.mapId;
  shadowText(ctx, mapName, cx, 122, `24px ${DISPLAY_FONT}`, '#ffffff', 'center', 'middle');
  // A refresh behind a table that's already showing stays quiet.
  const status = board.loading && !board.loaded ? 'Loading…' : board.online ? 'Online leaderboard' : "Can't reach the server";
  const dots = game.maps.length > 1 ? game.maps.map((m) => (m.id === board.mapId ? '●' : '○')).join(' ') + '   ' : '';
  shadowText(ctx, dots + status, cx, 145, '14px monospace', '#9a9a9a', 'center', 'middle');

  scoreArrows(game).forEach((r, i) => drawArrow(ctx, r, i === 0 ? -1 : 1, lit[i]));

  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(x, top, w, h);
  cols.forEach((c) => shadowText(ctx, c.label, c.x, top + 20, 'bold 13px monospace', '#7a7a7a', c.align ?? 'center', 'middle'));

  if (board.entries.length === 0) {
    // Until a map's table first arrives, say so rather than claim it's empty.
    const empty = !board.loaded
      ? board.loading ? 'Loading…' : 'High scores are kept on the server.'
      : 'No runs yet. Grab a hammer.';
    shadowText(ctx, empty, cx, top + h / 2, '16px monospace', '#a0a0a0', 'center', 'middle');
    return;
  }
  for (let i = 0; i < MAX_SCORES; i++) {
    const s = board.entries[i];
    const y = top + 50 + i * SCORE_ROW_H;
    if (!s) {
      shadowText(ctx, `${i + 1}`, cols[0].x, y, '16px monospace', '#444', 'center', 'middle');
      continue;
    }
    const color = i === board.lastRank ? '#f2d15c' : i === 0 ? '#ffffff' : '#c8c8c8';
    const date = s.date ? new Date(s.date).toLocaleDateString() : '—';
    const name = s.partySize > 1 ? `${s.name} (${s.partySize}P)` : s.name;
    const values = [`${i + 1}`, name, `${s.round}`, `${s.kills}`, s.points ? `${s.points}` : '—', date];
    values.forEach((v, c) => shadowText(ctx, v, cols[c].x, y, '16px monospace', color, cols[c].align ?? 'center', 'middle'));
    if (s.guest) {
      ctx.font = '16px monospace';
      shadowText(ctx, 'GUEST', cols[1].x + ctx.measureText(name).width + 10, y + 1, 'bold 11px monospace', '#7a7a7a', 'left', 'middle');
    }
  }
}

/** A previous (dir -1) or next (dir 1) arrow panel, in the menu buttons' style. */
function drawArrow(ctx: CanvasRenderingContext2D, r: Rect, dir: number, lit: boolean): void {
  ctx.fillStyle = lit ? 'rgba(140, 16, 16, 0.9)' : 'rgba(12, 12, 12, 0.72)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = lit ? '#e04848' : 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  const mx = r.x + r.w / 2;
  const my = r.y + r.h / 2;
  const s = r.w * 0.22;
  ctx.fillStyle = lit ? '#ffffff' : '#c8c8c8';
  ctx.beginPath();
  ctx.moveTo(mx + dir * s, my);
  ctx.lineTo(mx - dir * s, my - s * 1.4);
  ctx.lineTo(mx - dir * s, my + s * 1.4);
  ctx.closePath();
  ctx.fill();
}

/** GameRoom.MAX_PLAYERS. */
const MAX_PLAYERS = 4;
const LOBBY_ROW_H = 36;

function drawLobby(ctx: CanvasRenderingContext2D, game: Game): void {
  const cx = VIEW_W / 2;
  const room = game.room;
  shadowText(ctx, 'ROOM CODE', cx, 140, 'bold 13px monospace', '#9a9a9a', 'center', 'middle');
  shadowText(ctx, room?.code ?? '····', cx, 182, `64px ${DISPLAY_FONT}`, '#f2d15c', 'center', 'middle');
  const map = game.maps.find((m) => m.id === room?.mapId)?.name ?? room?.mapId ?? '';
  shadowText(ctx, map, cx, 222, '14px monospace', '#9a9a9a', 'center', 'middle');

  const x = 250;
  const w = 460;
  const top = 238;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(x, top, w, MAX_PLAYERS * LOBBY_ROW_H + 12);
  const players = game.lobby?.players ?? [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = players[i];
    const y = top + 6 + i * LOBBY_ROW_H + LOBBY_ROW_H / 2;
    if (!p) {
      shadowText(ctx, 'Open seat', x + 24, y, '16px monospace', '#555', 'left', 'middle');
      continue;
    }
    const you = p.id === game.you;
    shadowText(ctx, you ? `${p.name} (you)` : p.name, x + 24, y, 'bold 17px monospace', you ? '#ffffff' : '#d8d8d8', 'left', 'middle');
    const [tag, color] = !p.connected
      ? ['AWAY', '#e05050']
      : p.id === game.lobby?.ownerId
        ? ['HOST', '#f2d15c']
        : p.ready ? ['READY', '#6ad06a'] : ['NOT READY', '#8a8a8a'];
    shadowText(ctx, tag, x + w - 24, y, 'bold 14px monospace', color, 'right', 'middle');
  }
  const waiting = players.filter((p) => p.id !== game.lobby?.ownerId && !p.ready).length;
  const status = game.isHost
    ? waiting > 0 ? `Waiting for ${waiting} to ready up` : players.length > 1 ? 'Everyone is ready' : 'Start alone, or wait for friends'
    : 'The host starts the game';
  shadowText(ctx, status, cx, top + MAX_PLAYERS * LOBBY_ROW_H + 30, '14px monospace', '#a0a0a0', 'center', 'middle');
}

function drawAccount(ctx: CanvasRenderingContext2D): void {
  const cx = VIEW_W / 2;
  const id = loadIdentity();
  const [line, sub] = !id
    ? ['Not signed in', 'Play as a guest, or create a free account']
    : !id.account
      ? [`Playing as ${id.name} (guest)`, 'An account unlocks every map and online co-op']
      : !id.token
        ? [`${id.name}`, 'Signed out on this device']
        : [`Signed in as ${id.name}`, id.verified ? id.email ?? '' : `${id.email ?? ''} (not verified: guest limits apply)`];
  shadowText(ctx, line, cx, 170, `24px ${DISPLAY_FONT}`, '#ffffff', 'center', 'middle');
  if (sub) shadowText(ctx, sub, cx, 202, '15px monospace', '#a0a0a0', 'center', 'middle');
}

function drawControls(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(170, 145, 620, 345);
  controlText.controls.forEach(([key, action], i) => {
    const y = 180 + i * 35;
    shadowText(ctx, key, VIEW_W / 2 - 20, y, 'bold 16px monospace', '#f2d15c', 'right', 'middle');
    shadowText(ctx, action, VIEW_W / 2 + 20, y, '16px monospace', '#e0e0e0', 'left', 'middle');
  });
}
