import { addAdmin, AuthError, listAdmins, removeAdmin, type AdminRow } from './api';
import { h, modal, toast } from './dom';
import { ago } from './fmt';
import type { Page } from './main';
import { table } from './table';

const el = document.getElementById('page-admins')!;

/** Who can log in to this portal. */
export const adminsPage: Page = {
  show() {
    void load();
  },
  hide() {},
};

async function load(): Promise<void> {
  let rows: AdminRow[];
  try {
    rows = await listAdmins();
  } catch (e) {
    if (!(e instanceof AuthError)) toast((e as Error).message, 'bad');
    return;
  }
  el.replaceChildren(
    h('div', { class: 'dash-head' }, h('h1', {}, 'Admins'), h('span', { class: 'spacer' }),
      h('button', { class: 'primary', onclick: () => void add() }, 'Add admin')),
    h('div', { class: 'narrow' },
      table([
        { title: 'Username', cell: (a) => a.username },
        { title: 'Added', cell: (a) => ago(a.createdAt) },
        { title: 'Last login', cell: (a) => ago(a.lastLoginAt) },
        { title: '', cell: (a) => h('button', { class: 'danger', onclick: (e) => { e.stopPropagation(); void remove(a); } }, 'Remove') },
      ], rows),
      h('p', { class: 'hint' }, "You can't remove yourself, so there's always at least one admin.")));
}

async function add(): Promise<void> {
  const user = h('input', { type: 'text', autocomplete: 'off', style: 'width:100%' });
  const pass = h('input', { type: 'password', autocomplete: 'new-password', style: 'width:100%' });
  const res = await modal('Add admin', [
    h('div', { class: 'row' }, h('label', {}, 'Username'), user),
    h('div', { class: 'row' }, h('label', {}, 'Password'), pass),
    h('p', { class: 'hint' }, '3–32 letters, digits, _ . or -; passwords need at least 10 characters. They can change it after logging in.'),
  ], ['Add', 'Cancel']);
  if (res !== 'Add') return;
  try {
    await addAdmin(user.value, pass.value);
    toast(`Added ${user.value.trim().toLowerCase()}`, 'good');
    void load();
  } catch (e) {
    if (!(e instanceof AuthError)) toast((e as Error).message, 'bad');
  }
}

async function remove(a: AdminRow): Promise<void> {
  if ((await modal(`Remove ${a.username}?`, h('p', {}, 'They are logged out and can no longer log in.'), ['Remove', 'Cancel'])) !== 'Remove') return;
  try {
    await removeAdmin(a.id);
    toast(`Removed ${a.username}`, 'good');
    void load();
  } catch (e) {
    if (!(e instanceof AuthError)) toast((e as Error).message, 'bad');
  }
}
