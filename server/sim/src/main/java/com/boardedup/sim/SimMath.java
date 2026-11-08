package com.boardedup.sim;

/** Vector and angle helpers, matching client/src/core/math.ts. */
public final class SimMath {
    public static final double TAU = Math.PI * 2;

    private SimMath() {}

    public static double clamp(double v, double lo, double hi) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    public static double lerp(double a, double b, double t) {
        return a + (b - a) * t;
    }

    public static double dist(double ax, double ay, double bx, double by) {
        return Math.hypot(bx - ax, by - ay);
    }

    /** Signed shortest angle from {@code from} to {@code to}, in [-PI, PI]. */
    public static double angleDiff(double from, double to) {
        double d = (to - from) % TAU;
        if (d > Math.PI) d -= TAU;
        if (d < -Math.PI) d += TAU;
        return d;
    }

    /** Rotate angle {@code a} toward {@code target} by at most {@code maxStep} radians. */
    public static double turnToward(double a, double target, double maxStep) {
        double d = angleDiff(a, target);
        return Math.abs(d) <= maxStep ? target : a + Math.signum(d) * maxStep;
    }

    /** Distance along a normalized ray to its first intersection with a circle, or -1 on a miss. */
    public static double rayCircle(double ox, double oy, double dx, double dy, double cx, double cy, double r) {
        double fx = ox - cx;
        double fy = oy - cy;
        double c = fx * fx + fy * fy - r * r;
        if (c <= 0) return 0;
        double b = fx * dx + fy * dy;
        if (b > 0) return -1;
        double disc = b * b - c;
        if (disc < 0) return -1;
        return -b - Math.sqrt(disc);
    }
}
