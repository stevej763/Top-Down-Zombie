const PREFIX = 'top-down-survival-';
const OLD_PREFIX = 'boarded-up-';

/** `localStorage.getItem` for one of our keys, first moving over a value saved under the game's old name. */
export function loadStored(key: string): string | null {
  const old = OLD_PREFIX + key.slice(PREFIX.length);
  const prev = localStorage.getItem(old);
  if (prev !== null) {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, prev);
    localStorage.removeItem(old);
  }
  return localStorage.getItem(key);
}
