package com.topdownsurvival.sim;

/** Anything with a position that collides as a circle (the player and zombies). */
public abstract class Body {
    public double x;
    public double y;

    protected Body(double x, double y) {
        this.x = x;
        this.y = y;
    }
}
