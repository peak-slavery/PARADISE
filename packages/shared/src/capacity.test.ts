import { describe, expect, it } from 'vitest';

import {
  CAPACITY_THRESHOLDS,
  CapacityManager,
  capacityBand,
  capacitySnapshot,
  decideCapacity,
} from './capacity.js';

function snapshot(usage: number, healthy = true) {
  return capacitySnapshot({
    service: 'redis',
    provider: 'upstash',
    resource: 'commands',
    quota: 100,
    usage,
    healthy,
    cooldownUntil: null,
    resetAt: null,
  });
}

describe('capacity policy', () => {
  it('uses the five directive threshold bands at exact boundaries', () => {
    expect(capacityBand(69, 100)).toBe('normal');
    expect(capacityBand(70, 100)).toBe('cache-batch');
    expect(capacityBand(79.9, 100)).toBe('cache-batch');
    expect(capacityBand(80, 100)).toBe('aggressive-optimization');
    expect(capacityBand(89.9, 100)).toBe('aggressive-optimization');
    expect(capacityBand(90, 100)).toBe('shed-noncritical');
    expect(capacityBand(94.9, 100)).toBe('shed-noncritical');
    expect(capacityBand(95, 100)).toBe('emergency-protection');
    expect(CAPACITY_THRESHOLDS.emergencyProtection).toBe(0.95);
  });

  it('fails closed when quota is invalid or usage is non-finite', () => {
    expect(capacityBand(1, 0)).toBe('emergency-protection');
    expect(capacityBand(Number.NaN, 100)).toBe('emergency-protection');
    expect(capacitySnapshot({
      service: 'x', provider: 'y', resource: 'z', quota: 0, usage: 0,
      healthy: true, cooldownUntil: null, resetAt: null,
    }).remaining).toBe(0);
  });

  it('retains critical/security work while shedding optional work', () => {
    const pressured = snapshot(92);
    expect(decideCapacity(pressured, 'security').allowed).toBe(true);
    expect(decideCapacity(pressured, 'durable').allowed).toBe(true);
    expect(decideCapacity(pressured, 'optional').allowed).toBe(false);

    const emergency = snapshot(97);
    expect(decideCapacity(emergency, 'critical').allowed).toBe(true);
    expect(decideCapacity(emergency, 'security').allowed).toBe(true);
    expect(decideCapacity(emergency, 'core').allowed).toBe(false);
  });

  it('sheds non-critical work when the dependency is unhealthy', () => {
    const unhealthy = snapshot(20, false);
    expect(decideCapacity(unhealthy, 'security').allowed).toBe(true);
    expect(decideCapacity(unhealthy, 'critical').allowed).toBe(true);
    expect(decideCapacity(unhealthy, 'durable').allowed).toBe(false);
    expect(decideCapacity(unhealthy, 'optional').allowed).toBe(false);
  });

  it('tracks resources deterministically and denies unreported capacity', () => {
    const manager = new CapacityManager();
    expect(manager.decide('redis', 'upstash', 'commands', 'optional').allowed).toBe(false);
    manager.record(snapshot(75));
    expect(manager.get('redis', 'upstash', 'commands')?.band).toBe('cache-batch');
    expect(manager.decide('redis', 'upstash', 'commands', 'optional').allowed).toBe(true);
    expect(manager.list()).toHaveLength(1);
  });
});
