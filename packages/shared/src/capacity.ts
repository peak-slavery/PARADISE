// ---------------------------------------------------------------------------
// Shared capacity policy.
//
// This module is deliberately pure: providers and storage adapters report
// usage, while this policy decides what work is safe to admit. Keeping the
// thresholds here prevents Redis, AI providers, and background jobs from
// inventing different meanings for "near quota".
// ---------------------------------------------------------------------------

export type CapacityBand =
  | 'normal'
  | 'cache-batch'
  | 'aggressive-optimization'
  | 'shed-noncritical'
  | 'emergency-protection';

export type WorkloadPriority =
  | 'critical'
  | 'security'
  | 'durable'
  | 'core'
  | 'essential'
  | 'optional';

export interface CapacitySnapshot {
  service: string;
  provider: string;
  resource: string;
  quota: number;
  usage: number;
  remaining: number;
  utilization: number;
  band: CapacityBand;
  healthy: boolean;
  cooldownUntil: number | null;
  resetAt: number | null;
}

export interface CapacityDecision {
  allowed: boolean;
  band: CapacityBand;
  reason: string;
}

/** Directive thresholds: <70 normal, 70–80 cache/batch, 80–90 optimize,
 * 90–95 shed noncritical, 95+ emergency protection. */
export const CAPACITY_THRESHOLDS = Object.freeze({
  cacheBatch: 0.70,
  aggressiveOptimization: 0.80,
  shedNoncritical: 0.90,
  emergencyProtection: 0.95,
});

function clampRatio(usage: number, quota: number): number {
  if (!Number.isFinite(usage) || !Number.isFinite(quota) || quota <= 0) return 1;
  return Math.max(0, usage / quota);
}

export function capacityBand(usage: number, quota: number): CapacityBand {
  const ratio = clampRatio(usage, quota);
  if (ratio >= CAPACITY_THRESHOLDS.emergencyProtection) return 'emergency-protection';
  if (ratio >= CAPACITY_THRESHOLDS.shedNoncritical) return 'shed-noncritical';
  if (ratio >= CAPACITY_THRESHOLDS.aggressiveOptimization) return 'aggressive-optimization';
  if (ratio >= CAPACITY_THRESHOLDS.cacheBatch) return 'cache-batch';
  return 'normal';
}

export function capacitySnapshot(input: Omit<CapacitySnapshot, 'remaining' | 'utilization' | 'band'>): CapacitySnapshot {
  const utilization = clampRatio(input.usage, input.quota);
  return {
    ...input,
    remaining: Math.max(0, input.quota - input.usage),
    utilization,
    band: capacityBand(input.usage, input.quota),
  };
}

/**
 * Critical/security work remains admissible during pressure, while optional
 * work is shed at 90% and all non-critical work is blocked at 95%+. Durable
 * and core work stay available below emergency protection so authentication,
 * authorization, and permanent state retain priority.
 */
export function decideCapacity(snapshot: CapacitySnapshot, priority: WorkloadPriority): CapacityDecision {
  if (!snapshot.healthy) {
    const allowed = priority === 'critical' || priority === 'security';
    return {
      allowed,
      band: snapshot.band,
      reason: allowed ? 'dependency unhealthy; critical/security workload retained' : 'dependency unhealthy; non-critical workload shed',
    };
  }

  if (snapshot.band === 'normal') return { allowed: true, band: snapshot.band, reason: 'within normal capacity' };
  if (snapshot.band === 'cache-batch') return { allowed: true, band: snapshot.band, reason: 'admit with cache/batch policy' };
  if (snapshot.band === 'aggressive-optimization') return { allowed: priority !== 'optional', band: snapshot.band, reason: priority === 'optional' ? 'optional workload deferred during optimization' : 'admit with aggressive optimization' };
  if (snapshot.band === 'shed-noncritical') {
    const allowed = priority === 'critical' || priority === 'security' || priority === 'durable' || priority === 'core';
    return { allowed, band: snapshot.band, reason: allowed ? 'priority workload retained while non-critical work sheds' : 'non-critical workload shed at 90% capacity' };
  }

  const allowed = priority === 'critical' || priority === 'security';
  return { allowed, band: snapshot.band, reason: allowed ? 'emergency protection retains critical/security workload' : 'emergency protection blocks non-critical workload' };
}

export class CapacityManager {
  private readonly resources = new Map<string, CapacitySnapshot>();

  record(snapshot: CapacitySnapshot): CapacitySnapshot {
    const normalized = capacitySnapshot(snapshot);
    this.resources.set(this.key(normalized), normalized);
    return normalized;
  }

  get(service: string, provider: string, resource: string): CapacitySnapshot | null {
    return this.resources.get(this.key({ service, provider, resource })) ?? null;
  }

  decide(service: string, provider: string, resource: string, priority: WorkloadPriority): CapacityDecision {
    const snapshot = this.get(service, provider, resource);
    if (!snapshot) return { allowed: false, band: 'emergency-protection', reason: 'capacity has not been reported' };
    return decideCapacity(snapshot, priority);
  }

  list(): CapacitySnapshot[] {
    return [...this.resources.values()].sort((a, b) => this.key(a).localeCompare(this.key(b)));
  }

  private key(input: Pick<CapacitySnapshot, 'service' | 'provider' | 'resource'>): string {
    return `${input.service}:${input.provider}:${input.resource}`;
  }
}
