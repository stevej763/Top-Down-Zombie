package com.topdownsurvival.sim;

import com.topdownsurvival.sim.Defs.WeaponDef;

/** Per-instance ammo, reload state and upgrade tier. */
public final class Weapon {
    public final WeaponDef def;
    private final Defs defs;
    public int tier;
    public int mag;
    public int reserve;
    public double cooldown;
    public double reloadTimer;
    private double reloadDuration = 1;

    public Weapon(Defs defs, WeaponDef def) {
        this.defs = defs;
        this.def = def;
        this.mag = magSize();
        this.reserve = reserveSize();
    }

    public String name() {
        return def.name() + defs.upgrade.suffix().get(tier);
    }

    public double damage() {
        var mults = def.upgradeDamage() != null ? def.upgradeDamage() : defs.upgrade.damage();
        return def.damage() * mults.get(tier);
    }

    /** Holding one in each hand. */
    public boolean akimbo() {
        return def.akimbo() != null && tier >= def.akimbo().fromTier();
    }

    public double fireInterval() {
        return def.fireInterval() * (akimbo() ? def.akimbo().fireInterval() : 1);
    }

    public int magSize() {
        return (int) Math.round(def.mag() * ammoMult());
    }

    public int reserveSize() {
        return (int) Math.round(def.reserve() * ammoMult());
    }

    private double ammoMult() {
        return defs.upgrade.ammo().get(tier) * (akimbo() ? def.akimbo().ammo() : 1);
    }

    /** Upgraded weapons cost more to refill at the wall. */
    public int ammoCost() {
        return def.ammoCost() * (1 + tier * 2);
    }

    /** 0..1 through the current reload. */
    public double reloadProgress() {
        return reloading() ? 1 - reloadTimer / reloadDuration : 0;
    }

    public boolean reloading() {
        return reloadTimer > 0;
    }

    public boolean isFull() {
        return mag == magSize() && reserve == reserveSize();
    }

    public void update(double dt) {
        cooldown = Math.max(0, cooldown - dt);
        if (reloadTimer > 0) {
            reloadTimer -= dt;
            if (reloadTimer <= 0) finishReload();
        }
    }

    public boolean canFire() {
        return cooldown <= 0 && !reloading() && mag > 0;
    }

    public boolean startReload(double timeMult) {
        if (reloading() || mag >= magSize() || reserve <= 0) return false;
        reloadTimer = reloadDuration = def.reloadTime() * timeMult;
        return true;
    }

    public void cancelReload() {
        reloadTimer = 0;
    }

    public void refill() {
        mag = magSize();
        reserve = reserveSize();
        reloadTimer = 0;
    }

    public void upgrade() {
        if (tier >= defs.maxTier) return;
        tier++;
        refill();
    }

    private void finishReload() {
        int n = Math.min(magSize() - mag, reserve);
        mag += n;
        reserve -= n;
        reloadTimer = 0;
    }
}
