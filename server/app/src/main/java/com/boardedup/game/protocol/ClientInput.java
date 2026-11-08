package com.boardedup.game.protocol;

import com.boardedup.sim.PlayerInput;

/** One client tick of input: a {@link PlayerInput} plus the sequence number the server acks in snapshots. */
public record ClientInput(
        int seq, int moveX, int moveY, double aim,
        boolean fireHeld, boolean firePressed, boolean reload, boolean knife,
        boolean interactHeld, boolean interactPressed, int selectSlot, boolean swap) {

    public static ClientInput of(int seq, PlayerInput in) {
        return new ClientInput(seq, in.moveX(), in.moveY(), in.aim(), in.fireHeld(), in.firePressed(), in.reload(), in.knife(),
                in.interactHeld(), in.interactPressed(), in.selectSlot(), in.swap());
    }

    /** Sanitized: clients are untrusted, and a NaN aim would spread through the sim. */
    public PlayerInput toPlayerInput() {
        return new PlayerInput(Integer.signum(moveX), Integer.signum(moveY), Double.isFinite(aim) ? aim : 0,
                fireHeld, firePressed, reload, knife, interactHeld, interactPressed,
                selectSlot == 0 || selectSlot == 1 ? selectSlot : -1, swap);
    }
}
