package com.boardedup.sim;

/**
 * One tick of one player's intent, mirroring client/src/game/input.ts. "Pressed" flags are true
 * only on the tick the key went down.
 *
 * @param moveX movement direction, -1, 0 or 1 (likewise moveY)
 * @param aim aim angle in radians, world space
 * @param selectSlot weapon slot 0 or 1 to select, or -1 for no change
 * @param swap swap to the other weapon
 */
public record PlayerInput(
        int moveX, int moveY, double aim,
        boolean fireHeld, boolean firePressed, boolean reload, boolean knife,
        boolean interactHeld, boolean interactPressed, int selectSlot, boolean swap) {

    public static final PlayerInput NONE = new PlayerInput(0, 0, 0, false, false, false, false, false, false, -1, false);

    public static Builder builder() {
        return new Builder();
    }

    /** Mutable builder, mostly for tests and bots. */
    public static final class Builder {
        public int moveX, moveY, selectSlot = -1;
        public double aim;
        public boolean fireHeld, firePressed, reload, knife, interactHeld, interactPressed, swap;

        public Builder move(int x, int y) { moveX = x; moveY = y; return this; }
        public Builder aim(double a) { aim = a; return this; }
        public Builder fire() { fireHeld = true; firePressed = true; return this; }
        public Builder fireHeld() { fireHeld = true; return this; }
        public Builder reload() { reload = true; return this; }
        public Builder knife() { knife = true; return this; }
        public Builder interact() { interactHeld = true; interactPressed = true; return this; }
        public Builder interactHeld() { interactHeld = true; return this; }

        public PlayerInput build() {
            return new PlayerInput(moveX, moveY, aim, fireHeld, firePressed, reload, knife, interactHeld, interactPressed, selectSlot, swap);
        }
    }
}
