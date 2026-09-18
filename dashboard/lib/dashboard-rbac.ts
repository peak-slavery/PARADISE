// Server-side dashboard authorization. This module is intentionally free of
// `next/headers` so route handlers can test the policy without a request context.
import { randomBytes } from 'node:crypto';

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { DashboardRole } from '@/lib/types';

export const DASHBOARD_ROLES = [
  'OWNER',
  'SUPER_ADMIN',
  'SECURITY_ADMIN',
  'TCG_ADMIN',
  'SOFI_ADMIN',
  'BOT_OPERATOR',
  'AUDITOR',
] as const satisfies readonly DashboardRole[];

export const DASHBOARD_ROLE_SET = new Set<DashboardRole>(DASHBOARD_ROLES);

export type DashboardOperation =
  | 'dashboard.read'
  | 'guild.read'
  | 'guild.config.read'
  | 'guild.config.write'
  | 'guild.bot_state.read'
  | 'guild.bot_state.write'
  | 'guild.embed.send'
  | 'guild.audit.read'
  | 'guild.access.read'
  | 'guild.access.write'
  | 'security.review'
  | 'security.remediate'
  | 'secret.metadata.read'
  | 'secret.write'
  | 'secret.reveal'
  | 'infrastructure.read'
  | 'infrastructure.write';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface OperationPolicy {
  roles: readonly DashboardRole[];
  risk: RiskLevel;
  scope: 'global' | 'guild';
}

const OPERATION_POLICIES: Readonly<Record<DashboardOperation, OperationPolicy>> = {
  'dashboard.read': { roles: DASHBOARD_ROLES, risk: 'low', scope: 'global' },
  'guild.read': { roles: DASHBOARD_ROLES, risk: 'low', scope: 'guild' },
  'guild.config.read': { roles: DASHBOARD_ROLES, risk: 'low', scope: 'guild' },
  'guild.config.write': {
    roles: ['OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN', 'TCG_ADMIN', 'SOFI_ADMIN'],
    risk: 'medium',
    scope: 'guild',
  },
  'guild.bot_state.read': { roles: DASHBOARD_ROLES, risk: 'low', scope: 'guild' },
  'guild.bot_state.write': {
    roles: ['OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN', 'TCG_ADMIN', 'SOFI_ADMIN'],
    risk: 'high',
    scope: 'guild',
  },
  'guild.embed.send': {
    roles: ['OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN', 'TCG_ADMIN', 'SOFI_ADMIN'],
    risk: 'high',
    scope: 'guild',
  },
  'guild.audit.read': { roles: DASHBOARD_ROLES, risk: 'low', scope: 'guild' },
  'guild.access.read': {
    roles: ['OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN', 'TCG_ADMIN', 'SOFI_ADMIN', 'BOT_OPERATOR'],
    risk: 'medium',
    scope: 'global',
  },
  'guild.access.write': {
    roles: ['OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN'],
    risk: 'critical',
    scope: 'global',
  },
  'security.review': { roles: ['OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN', 'AUDITOR'], risk: 'medium', scope: 'guild' },
  'security.remediate': {
    roles: ['OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN'],
    risk: 'high',
    scope: 'guild',
  },
  'secret.metadata.read': { roles: ['OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN', 'AUDITOR'], risk: 'medium', scope: 'global' },
  'secret.write': {
    roles: ['OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN'],
    risk: 'critical',
    scope: 'global',
  },
  'secret.reveal': {
    roles: ['OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN'],
    risk: 'critical',
    scope: 'global',
  },
  'infrastructure.read': { roles: ['OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN', 'AUDITOR'], risk: 'medium', scope: 'global' },
  'infrastructure.write': {
    roles: ['OWNER', 'SUPER_ADMIN', 'SECURITY_ADMIN'],
    risk: 'critical',
    scope: 'global',
  },
};

export const HIGH_RISK_OPERATIONS = new Set<DashboardOperation>(
  Object.entries(OPERATION_POLICIES)
    .filter(([, policy]) => policy.risk === 'high' || policy.risk === 'critical')
    .map(([operation]) => operation as DashboardOperation),
);

export function isDashboardRole(value: string): value is DashboardRole {
  return DASHBOARD_ROLE_SET.has(value as DashboardRole);
}

export function getOperationPolicy(operation: DashboardOperation): OperationPolicy | undefined {
  return OPERATION_POLICIES[operation];
}

export function canPerformOperation(
  roles: readonly DashboardRole[],
  operation: DashboardOperation,
  scope: 'global' | 'guild' = 'global',
): boolean {
  const policy = OPERATION_POLICIES[operation];
  if (!policy || policy.scope !== scope) return false;
  return roles.some((role) => policy.roles.includes(role));
}

export function requiresStepUp(operation: DashboardOperation): boolean {
  return HIGH_RISK_OPERATIONS.has(operation);
}

export interface StepUpChallenge {
  /** Opaque, high-entropy challenge ID; never derive the user ID or role from it. */
  challengeId: string;
  expiresAt: string;
  operation: DashboardOperation;
  scope: 'global' | 'guild';
  guildId?: string;
}

export interface StepUpGrant {
  challengeId: string;
  expiresAt: string;
  operation: DashboardOperation;
  scope: 'global' | 'guild';
  userId: string;
  guildId?: string;
}

export interface StepUpRequest {
  userId: string;
  roles: readonly DashboardRole[];
  operation: DashboardOperation;
  scope: 'global' | 'guild';
  guildId?: string;
}

export interface StepUpStore {
  createChallenge(request: StepUpRequest): Promise<StepUpChallenge | null>;
  consumeChallenge(challengeId: string, userId: string): Promise<StepUpGrant | null>;
  hasValidGrant(
    userId: string,
    operation: DashboardOperation,
    scope: 'global' | 'guild',
    guildId?: string,
  ): Promise<boolean>;
  deleteGrant(challengeId: string): Promise<void>;
}

const STEP_UP_TTL_MS = 5 * 60 * 1000;
const STEP_UP_GRANT_TTL_MS = 5 * 60 * 1000;

function validGuildId(guildId: string | undefined): boolean {
  return typeof guildId === 'string' && /^\d{17,20}$/.test(guildId);
}

function normalizeChallengeId(challengeId: string): string | null {
  return /^[a-f0-9]{32}$/.test(challengeId) ? challengeId : null;
}

function validStepUpRequest(request: StepUpRequest): boolean {
  const policy = OPERATION_POLICIES[request.operation];
  if (!policy || !requiresStepUp(request.operation) || policy.scope !== request.scope) return false;
  if (!request.userId) return false;
  if (!request.roles.some((role) => policy.roles.includes(role))) return false;
  return request.scope !== 'guild' || validGuildId(request.guildId);
}

/**
 * Minimal in-process step-up store for tests and single-process deployments.
 * Production route handlers use the database-backed store so grants survive
 * serverless instance changes and one-time consumption is atomic.
 */
export class MemoryStepUpStore implements StepUpStore {
  private readonly challenges = new Map<string, StepUpChallenge & { userId: string }>();
  private readonly grants = new Map<string, StepUpGrant>();
  private readonly byUser = new Map<string, Set<string>>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async createChallenge(request: StepUpRequest): Promise<StepUpChallenge | null> {
    if (!validStepUpRequest(request)) return null;
    const expiresAt = new Date(this.now() + STEP_UP_TTL_MS).toISOString();
    const challenge: StepUpChallenge & { userId: string } = {
      challengeId: randomBytes(16).toString('hex'),
      expiresAt,
      operation: request.operation,
      scope: request.scope,
      ...(request.scope === 'guild' ? { guildId: request.guildId } : {}),
      userId: request.userId,
    };
    this.challenges.set(challenge.challengeId, challenge);
    this.prune();
    return {
      challengeId: challenge.challengeId,
      expiresAt,
      operation: request.operation,
      scope: request.scope,
      ...(request.scope === 'guild' ? { guildId: request.guildId } : {}),
    };
  }

  async consumeChallenge(challengeId: string, userId: string): Promise<StepUpGrant | null> {
    const normalized = normalizeChallengeId(challengeId);
    if (!normalized) return null;
    const challenge = this.challenges.get(normalized);
    this.challenges.delete(normalized);
    if (!challenge || challenge.userId !== userId) return null;
    const expiresAtMs = Date.parse(challenge.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= this.now()) return null;

    const grant: StepUpGrant = {
      challengeId: normalized,
      expiresAt: new Date(this.now() + STEP_UP_GRANT_TTL_MS).toISOString(),
      operation: challenge.operation,
      scope: challenge.scope,
      ...(challenge.scope === 'guild' ? { guildId: challenge.guildId } : {}),
      userId,
    };
    this.grants.set(normalized, grant);
    const userGrants = this.byUser.get(userId) ?? new Set<string>();
    userGrants.add(normalized);
    this.byUser.set(userId, userGrants);
    this.prune();
    return grant;
  }

  async deleteGrant(challengeId: string): Promise<void> {
    const normalized = normalizeChallengeId(challengeId);
    if (!normalized) return;
    const grant = this.grants.get(normalized);
    this.grants.delete(normalized);
    if (grant) this.byUser.get(grant.userId)?.delete(normalized);
  }

  async hasValidGrant(
    userId: string,
    operation: DashboardOperation,
    scope: 'global' | 'guild',
    guildId?: string,
  ): Promise<boolean> {
    const policy = OPERATION_POLICIES[operation];
    if (!policy || policy.scope !== scope) return false;
    if (scope === 'guild' && !validGuildId(guildId)) return false;
    this.prune();
    const grants = this.byUser.get(userId);
    if (!grants) return false;

    for (const grantId of grants) {
      const grant = this.grants.get(grantId);
      if (!grant || grant.userId !== userId || grant.operation !== operation) continue;
      const expiresAtMs = Date.parse(grant.expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= this.now()) continue;
      if (grant.scope !== scope) continue;
      if (scope === 'guild' && grant.guildId !== guildId) continue;
      if (scope === 'global' && grant.guildId !== undefined) continue;
      return true;
    }
    return false;
  }

  private prune(): void {
    const now = this.now();
    for (const [challengeId, challenge] of this.challenges) {
      if (Date.parse(challenge.expiresAt) <= now) this.challenges.delete(challengeId);
    }
    for (const [challengeId, grant] of this.grants) {
      if (Date.parse(grant.expiresAt) <= now) {
        this.grants.delete(challengeId);
        this.byUser.get(grant.userId)?.delete(challengeId);
      }
    }
  }
}

type StepUpRow = {
  challenge_id: string;
  user_id: string;
  operation: DashboardOperation;
  scope: 'global' | 'guild';
  guild_id: string | null;
  expires_at: string;
  consumed_at: string | null;
  grant_expires_at: string | null;
  roles: string[] | null;
};

function toGrant(row: StepUpRow): StepUpGrant {
  return {
    challengeId: row.challenge_id,
    expiresAt: row.grant_expires_at ?? row.expires_at,
    operation: row.operation,
    scope: row.scope,
    userId: row.user_id,
    ...(row.scope === 'guild' ? { guildId: row.guild_id ?? undefined } : {}),
  };
}

/** Durable, transactional step-up store for serverless route handlers. */
export class SupabaseStepUpStore implements StepUpStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async createChallenge(request: StepUpRequest): Promise<StepUpChallenge | null> {
    if (!validStepUpRequest(request)) return null;
    const challengeId = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + STEP_UP_TTL_MS).toISOString();
    const { error } = await this.supabase.from('dashboard_step_up_challenges').insert({
      challenge_id: challengeId,
      user_id: request.userId,
      operation: request.operation,
      scope: request.scope,
      guild_id: request.scope === 'guild' ? request.guildId : null,
      expires_at: expiresAt,
      roles: [...request.roles],
    });
    if (error) return null;
    return {
      challengeId,
      expiresAt,
      operation: request.operation,
      scope: request.scope,
      ...(request.scope === 'guild' ? { guildId: request.guildId } : {}),
    };
  }

  async consumeChallenge(challengeId: string, userId: string): Promise<StepUpGrant | null> {
    const normalized = normalizeChallengeId(challengeId);
    if (!normalized || !userId) return null;
    const { data: consumed, error: consumeError } = await this.supabase.rpc('consume_dashboard_step_up', {
      p_challenge_id: normalized,
      p_user_id: userId,
    });
    if (consumeError || consumed !== true) return null;

    const { data, error } = await this.supabase
      .from('dashboard_step_up_challenges')
      .select('challenge_id,user_id,operation,scope,guild_id,expires_at,consumed_at,grant_expires_at,roles')
      .eq('challenge_id', normalized)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data || data.consumed_at === null || data.grant_expires_at === null) return null;
    return toGrant(data as StepUpRow);
  }

  async hasValidGrant(
    userId: string,
    operation: DashboardOperation,
    scope: 'global' | 'guild',
    guildId?: string,
  ): Promise<boolean> {
    const policy = OPERATION_POLICIES[operation];
    if (!policy || policy.scope !== scope) return false;
    if (scope === 'guild' && !validGuildId(guildId)) return false;
    const { data, error } = await this.supabase
      .from('dashboard_step_up_challenges')
      .select('challenge_id,user_id,operation,scope,guild_id,expires_at,consumed_at,grant_expires_at,roles')
      .eq('user_id', userId)
      .gt('grant_expires_at', new Date().toISOString())
      .limit(64);
    if (error || !data) return false;

    return data.some((row) => {
      const grant = row as StepUpRow;
      if (grant.user_id !== userId || grant.operation !== operation || grant.scope !== scope) return false;
      if (grant.consumed_at === null || grant.grant_expires_at === null) return false;
      if (Date.parse(grant.grant_expires_at) <= Date.now()) return false;
      if (scope === 'guild') return grant.guild_id === guildId;
      return grant.guild_id === null;
    });
  }

  async deleteGrant(challengeId: string): Promise<void> {
    const normalized = normalizeChallengeId(challengeId);
    if (!normalized) return;
    await this.supabase.from('dashboard_step_up_challenges').delete().eq('challenge_id', normalized);
  }
}

export async function createDatabaseStepUpStore(): Promise<SupabaseStepUpStore | null> {
  const { createSupabaseServerClient } = await import('@/lib/supabase/server');
  const supabase = await createSupabaseServerClient();
  return supabase ? new SupabaseStepUpStore(supabase) : null;
}

export type RoleResolution =
  | { ok: true; userId: string; roles: readonly DashboardRole[] }
  | { ok: false; status: 401 | 403 | 503; error: string };

/**
 * Resolve dashboard roles from the database-backed admin relationship. Browser
 * metadata is cosmetic only and is never an authority for this result.
 */
export async function resolveDashboardRoles(): Promise<RoleResolution> {
  const { getCurrentUser, createSupabaseServerClient } = await import('@/lib/supabase/server');
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, error: 'Authentication required' };

  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, status: 503, error: 'Dashboard backend is unavailable' };

  let data: unknown;
  let error: unknown;
  try {
    const result = await supabase.rpc('dashboard_roles');
    data = result.data;
    error = result.error;
  } catch {
    return { ok: false, status: 503, error: 'Dashboard backend is unavailable' };
  }
  if (error || !Array.isArray(data)) {
    return { ok: false, status: 503, error: 'Dashboard backend is unavailable' };
  }

  const roles = data.filter((role): role is DashboardRole => typeof role === 'string' && isDashboardRole(role));
  if (roles.length !== data.length || roles.length === 0 || new Set(roles).size !== roles.length) {
    return { ok: false, status: 403, error: 'Dashboard access is not provisioned' };
  }
  return { ok: true, userId: user.id, roles };
}

export type OperationAuthorization =
  | { ok: true; userId: string; roles: readonly DashboardRole[] }
  | { ok: false; status: 401 | 403 | 404 | 409 | 503; error: string };

async function authorizeOperationBase(
  operation: DashboardOperation,
  scope: 'global' | 'guild',
): Promise<OperationAuthorization> {
  const roles = await resolveDashboardRoles();
  if (!roles.ok) return roles;

  const policy = OPERATION_POLICIES[operation];
  if (!policy || policy.scope !== scope) {
    return { ok: false, status: 404, error: 'Operation not found' };
  }
  if (!canPerformOperation(roles.roles, operation, scope)) {
    return { ok: false, status: 403, error: 'Dashboard operation forbidden' };
  }
  return { ok: true, userId: roles.userId, roles: roles.roles };
}

export async function authorizeOperation(
  operation: DashboardOperation,
  scope: 'global' | 'guild',
  guildId?: string,
): Promise<OperationAuthorization> {
  const base = await authorizeOperationBase(operation, scope);
  if (!base.ok) return base;
  if (!requiresStepUp(operation)) return base;

  const store = await createDatabaseStepUpStore();
  if (!store) return { ok: false, status: 503, error: 'Step-up authorization is unavailable' };
  try {
    const granted = await store.hasValidGrant(base.userId, operation, scope, guildId);
    if (!granted) return { ok: false, status: 409, error: 'Step-up authorization required' };
  } catch {
    return { ok: false, status: 503, error: 'Step-up authorization is unavailable' };
  }
  return base;
}

export async function authorizeGuildOperationBase(
  operation: DashboardOperation,
  guildId: string,
): Promise<OperationAuthorization> {
  const { authorizeGuildOrMaster } = await import('@/lib/authz');
  const guild = await authorizeGuildOrMaster(guildId);
  if (!guild.ok) return { ok: false, status: guild.status, error: guild.error };
  return authorizeOperationBase(operation, 'guild');
}

export async function authorizeGuildOperation(
  operation: DashboardOperation,
  guildId: string,
): Promise<OperationAuthorization> {
  const base = await authorizeGuildOperationBase(operation, guildId);
  if (!base.ok) return base;
  if (!requiresStepUp(operation)) return base;

  const store = await createDatabaseStepUpStore();
  if (!store) return { ok: false, status: 503, error: 'Step-up authorization is unavailable' };
  try {
    const granted = await store.hasValidGrant(base.userId, operation, 'guild', guildId);
    if (!granted) return { ok: false, status: 409, error: 'Step-up authorization required' };
  } catch {
    return { ok: false, status: 503, error: 'Step-up authorization is unavailable' };
  }
  return base;
}

export async function authorizeGlobalOperation(operation: DashboardOperation): Promise<OperationAuthorization> {
  return authorizeOperation(operation, 'global');
}

// Kept as a named compatibility helper for callers migrating from master-only
// authorization; global operations still use the deny-by-default role policy.
export async function authorizeMasterOperation(operation: DashboardOperation): Promise<OperationAuthorization> {
  return authorizeGlobalOperation(operation);
}

export function operationAuthorizationResponse(result: Exclude<OperationAuthorization, { ok: true }>) {
  return NextResponse.json({ error: result.error }, { status: result.status });
}
