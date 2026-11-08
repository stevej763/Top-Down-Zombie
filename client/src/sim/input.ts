/**
 * One tick of one player's intent. Built by the client from the keyboard and mouse; in
 * multiplayer it's what gets sent to the server. "Pressed" flags are true only on the tick
 * the key went down.
 */
export interface PlayerInput {
  /** Movement direction; each axis -1, 0 or 1. */
  moveX: number;
  moveY: number;
  /** Aim angle in radians, world space. */
  aim: number;
  fireHeld: boolean;
  firePressed: boolean;
  reload: boolean;
  knife: boolean;
  interactHeld: boolean;
  interactPressed: boolean;
  /** Select weapon slot 0 or 1, or -1 for no change. */
  selectSlot: number;
  /** Swap to the other weapon. */
  swap: boolean;
}

export const NO_INPUT: PlayerInput = {
  moveX: 0, moveY: 0, aim: 0, fireHeld: false, firePressed: false, reload: false, knife: false,
  interactHeld: false, interactPressed: false, selectSlot: -1, swap: false,
};
