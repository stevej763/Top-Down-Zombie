import { changePassword, login, logout, me, setUnauthorizedHandler, type Admin } from './api';
import { adminsPage } from './adminsPage';
import { h, modal, toast } from './dom';
import { gamesPage } from './gamesPage';
import { livePage } from './livePage';
import { mapsPage } from './mapsPage';
import { playersPage } from './playersPage';

/** One tab of the portal. `show` runs after its element is visible; `hide` stops its polling and loops. */
export interface Page {
  show(arg?: string): void;
  hide(): void;
}

const PAGES: Record<string, Page> = {
  live: livePage,
  games: gamesPage,
  players: playersPage,
  admins: adminsPage,
  maps: mapsPage,
};
const DEFAULT_PAGE = 'live';

const loginEl = document.getElementById('login')!;
const topEl = document.getElementById('top')!;
const meEl = document.getElementById('me')!;
let current: string | null = null;
let admin: Admin | null = null;

/**
 * `#players/<id>` opens a player; `#games/<id>` a game; `#maps/edit/<id>` the editor. Everything after
 * the first slash is the page's argument; a `?query` is left for the page to read.
 */
function route(): void {
  if (!admin) return;
  const path = location.hash.slice(1).split('?')[0];
  const slash = path.indexOf('/');
  const name = slash < 0 ? path : path.slice(0, slash);
  const arg = slash < 0 ? '' : path.slice(slash + 1);
  const page = PAGES[name] ? name : DEFAULT_PAGE;
  if (current && current !== page) PAGES[current].hide();
  for (const p of Object.keys(PAGES)) document.getElementById(`page-${p}`)!.hidden = p !== page;
  document.querySelectorAll<HTMLAnchorElement>('#tabs a').forEach((a) => a.classList.toggle('on', a.hash === `#${page}`));
  document.title = `${page[0].toUpperCase()}${page.slice(1)} · Top Down Survival admin`;
  current = page;
  PAGES[page].show(arg ? decodeURIComponent(arg) : undefined);
}

function enter(a: Admin): void {
  admin = a;
  loginEl.hidden = true;
  topEl.hidden = false;
  meEl.replaceChildren(
    h('span', { class: 'who' }, a.username),
    h('button', { onclick: () => void passwordDialog() }, 'Password'),
    h('button', { onclick: () => void signOut() }, 'Log out'),
  );
  route();
}

function leave(message: string): void {
  if (current) PAGES[current].hide();
  current = null;
  admin = null;
  topEl.hidden = true;
  for (const p of Object.keys(PAGES)) document.getElementById(`page-${p}`)!.hidden = true;
  showLogin(message);
}

function showLogin(message = ''): void {
  const user = h('input', { type: 'text', autocomplete: 'username', placeholder: 'Username', required: true });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password', required: true });
  const err = h('p', { class: 'error' }, message);
  const submit = h('button', { class: 'primary', type: 'submit' }, 'Log in');
  const form = h('form', { class: 'login-card' },
    h('div', { class: 'brand' }, 'TOP DOWN SURVIVAL ', h('span', {}, 'admin')),
    user, pass, err, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    err.textContent = '';
    try {
      enter(await login(user.value, pass.value));
    } catch (ex) {
      err.textContent = (ex as Error).message;
      pass.value = '';
      pass.focus();
    } finally {
      submit.disabled = false;
    }
  });
  loginEl.replaceChildren(form);
  loginEl.hidden = false;
  user.focus();
}

async function signOut(): Promise<void> {
  try {
    await logout();
  } catch {
    // Gone already.
  }
  leave('');
}

async function passwordDialog(): Promise<void> {
  const cur = h('input', { type: 'password', autocomplete: 'current-password', style: 'width:100%' });
  const next = h('input', { type: 'password', autocomplete: 'new-password', style: 'width:100%' });
  const again = h('input', { type: 'password', autocomplete: 'new-password', style: 'width:100%' });
  const res = await modal('Change password', [
    h('div', { class: 'row' }, h('label', {}, 'Current'), cur),
    h('div', { class: 'row' }, h('label', {}, 'New'), next),
    h('div', { class: 'row' }, h('label', {}, 'Again'), again),
    h('p', { class: 'hint' }, 'At least 10 characters. Your other sessions are logged out.'),
  ], ['Change', 'Cancel']);
  if (res !== 'Change') return;
  if (next.value !== again.value) {
    toast("The new passwords don't match", 'bad');
    return;
  }
  try {
    await changePassword(cur.value, next.value);
    toast('Password changed', 'good');
  } catch (e) {
    toast((e as Error).message, 'bad');
  }
}

setUnauthorizedHandler(() => {
  if (admin) leave('Your session ended. Log in again.');
});
window.addEventListener('hashchange', route);

async function boot(): Promise<void> {
  try {
    const a = await me();
    if (a) enter(a);
    else showLogin();
  } catch {
    showLogin("Can't reach the server.");
  }
}

void boot();
