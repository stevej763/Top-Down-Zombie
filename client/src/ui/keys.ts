/**
 * The words the UI uses for controls. The touch client (mobile/) swaps in its own before the game
 * starts, so the shared UI never has to know which kind of input it's under.
 */
export const controlText = {
  /** Starts every "… to buy" prompt. */
  press: 'Press E',
  hold: 'Hold E',
  reload: 'Press R to reload',
  /** Game over: "… to play again". */
  confirm: 'Press Enter',
  toMenu: 'Esc for main menu',
  /** The keyboard hints along the bottom of the menus. */
  menuHints: true,
  /** The Controls page: key, then what it does. */
  controls: [
    ['WASD / Arrows', 'Move'],
    ['Mouse', 'Aim'],
    ['Space / Left Click', 'Shoot'],
    ['R', 'Reload'],
    ['E', 'Buy / use  (hold to rebuild)'],
    ['F / V', 'Knife  (auto when out of ammo)'],
    ['1 / 2 / Q / Wheel', 'Switch weapon'],
    ['M', 'Mute'],
    ['Esc / P', 'Pause'],
  ] as [string, string][],
};
