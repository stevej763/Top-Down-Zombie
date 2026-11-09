type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
type Child = Node | string | null | undefined | false;

/** Create an element. `on*` attributes become listeners; text children are set as text (never HTML). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = String(v);
    else if (k === 'value') (el as HTMLInputElement).value = String(v);
    else if (k === 'checked') (el as HTMLInputElement).checked = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const modalEl = () => document.getElementById('modal') as HTMLDialogElement;

/**
 * Show a modal; resolves with the label of the button pressed, or null if dismissed (Esc).
 * The first button is the default (Enter in a text field presses it).
 */
export function modal(title: string, body: Child | Child[], buttons: string[] = ['OK']): Promise<string | null> {
  const dlg = modalEl();
  dlg.replaceChildren();
  return new Promise((resolve) => {
    const done = (v: string | null) => {
      resolve(v);
      dlg.close();
    };
    const btns = buttons.map((label, i) => h('button', { class: i === 0 ? 'primary' : '', onclick: () => done(label) }, label));
    const form = h('div', {}, h('h2', {}, title), ...(Array.isArray(body) ? body : [body]), h('div', { class: 'buttons' }, ...btns.slice().reverse()));
    form.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
        e.preventDefault();
        done(buttons[0]);
      }
    });
    dlg.append(form);
    dlg.onclose = () => resolve(null);
    dlg.showModal();
    (dlg.querySelector('input') as HTMLInputElement | null)?.focus();
  });
}

let toastTimer = 0;

export function toast(msg: string, kind: '' | 'good' | 'bad' = ''): void {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.className = kind), kind === 'bad' ? 6000 : 3500);
}
