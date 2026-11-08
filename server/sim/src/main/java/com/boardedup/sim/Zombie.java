package com.boardedup.sim;

import java.util.function.IntPredicate;

/** State machine: OUTSIDE → BREACHING → CLIMBING → INSIDE. */
public final class Zombie extends Body {
    public enum State { OUTSIDE, BREACHING, CLIMBING, INSIDE }

    public static final double RADIUS = 13;
    private static final double BREACH_RANGE = 26;
    private static final double ATTACK_WINDUP = 0.45;
    private static final double ATTACK_COOLDOWN = 0.8;
    /** Close enough with a clear line to walk straight at a player instead of following the flow field. */
    private static final double DIRECT_CHASE_RANGE = 180;

    static final IntPredicate OUTSIDE_SOLID = t -> t != Tile.OUTSIDE;
    static final IntPredicate INSIDE_SOLID = t -> t != Tile.FLOOR;

    /** Unique within a sim, for events and network snapshots. */
    public final int id;
    public final Barricade window;
    public final double maxHp;
    public final double speed;
    public final double damage;
    public final boolean runner;
    private final double tearInterval;
    public State state = State.OUTSIDE;
    public double facing;
    public double hp;
    public double attackTimer;
    public double tearTimer;
    public boolean dead;
    private double climbT;
    private double climbFromX;
    private double climbFromY;

    public Zombie(int id, Barricade window, double x, double y, double hp, double speed, double damage, boolean runner,
            double tearInterval) {
        super(x, y);
        this.id = id;
        this.window = window;
        this.hp = this.maxHp = hp;
        this.speed = speed;
        this.damage = damage;
        this.runner = runner;
        this.tearInterval = tearInterval;
        this.facing = Math.atan2(window.center.y() - y, window.center.x() - x);
    }

    public IntPredicate solid() {
        return state == State.INSIDE ? INSIDE_SOLID : OUTSIDE_SOLID;
    }

    void update(double dt, GameSim game) {
        Barricade b = window;
        switch (state) {
            case OUTSIDE -> {
                moveToward(b.outsidePoint.x(), b.outsidePoint.y(), speed, dt);
                game.map.collideCircle(this, RADIUS, OUTSIDE_SOLID);
                if (SimMath.dist(x, y, b.outsidePoint.x(), b.outsidePoint.y()) < BREACH_RANGE) {
                    state = State.BREACHING;
                    tearTimer = tearInterval * 0.6;
                }
            }
            case BREACHING -> {
                double d = SimMath.dist(x, y, b.outsidePoint.x(), b.outsidePoint.y());
                if (d > 3) moveToward(b.outsidePoint.x(), b.outsidePoint.y(), speed * 0.5, dt);
                facing = SimMath.turnToward(facing, Math.atan2(b.center.y() - y, b.center.x() - x), dt * 8);
                game.map.collideCircle(this, RADIUS, OUTSIDE_SOLID);
                if (d > BREACH_RANGE + 10) {
                    state = State.OUTSIDE;
                } else if (b.planks > 0) {
                    tearTimer -= dt;
                    if (tearTimer <= 0) {
                        game.tearPlank(b);
                        tearTimer = tearInterval;
                    }
                } else if (b.climber == null && d < 10) {
                    b.climber = this;
                    state = State.CLIMBING;
                    climbT = 0;
                    climbFromX = x;
                    climbFromY = y;
                }
            }
            case CLIMBING -> {
                climbT += dt / (runner ? 0.55 : 0.9);
                double t = Math.min(1, climbT);
                x = SimMath.lerp(climbFromX, b.insidePoint.x(), t);
                y = SimMath.lerp(climbFromY, b.insidePoint.y(), t);
                facing = Math.atan2(b.insidePoint.y() - b.center.y(), b.insidePoint.x() - b.center.x());
                if (t >= 1) {
                    state = State.INSIDE;
                    b.climber = null;
                }
            }
            case INSIDE -> {
                Player p = game.nearestAlivePlayer(x, y);
                if (p == null) {
                    // Nobody left standing to go after.
                    attackTimer = attackTimer > 0 ? 0 : Math.min(0, attackTimer + dt);
                    game.map.collideCircle(this, RADIUS, INSIDE_SOLID);
                    return;
                }
                double dp = SimMath.dist(x, y, p.x, p.y);
                double reach = RADIUS + Player.RADIUS + 6;

                if (dp < reach) {
                    attackTimer += dt;
                    if (attackTimer >= ATTACK_WINDUP) {
                        game.damagePlayer(p, damage);
                        attackTimer = -ATTACK_COOLDOWN;
                    }
                } else {
                    attackTimer = attackTimer > 0 ? 0 : Math.min(0, attackTimer + dt);
                }

                if (dp > reach - 4) {
                    double tx = p.x, ty = p.y;
                    if (!(dp < DIRECT_CHASE_RANGE && game.map.hasLOS(x, y, p.x, p.y))) {
                        Point next = game.flow.nextTarget(x, y);
                        if (next != null) {
                            tx = next.x();
                            ty = next.y();
                        }
                    }
                    moveToward(tx, ty, speed, dt);
                }
                if (dp < 80) facing = SimMath.turnToward(facing, Math.atan2(p.y - y, p.x - x), dt * 10);
                game.map.collideCircle(this, RADIUS, INSIDE_SOLID);
            }
        }
    }

    private void moveToward(double tx, double ty, double speed, double dt) {
        double dx = tx - x;
        double dy = ty - y;
        double d = Math.hypot(dx, dy);
        if (d < 0.001) return;
        double step = Math.min(d, speed * dt);
        x += (dx / d) * step;
        y += (dy / d) * step;
        facing = SimMath.turnToward(facing, Math.atan2(dy, dx), dt * 10);
    }
}
