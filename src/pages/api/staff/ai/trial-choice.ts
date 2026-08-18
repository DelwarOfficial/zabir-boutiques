/**
 * POST /api/staff/ai/trial-choice — record a blind A/B pick and reveal (N-29)
 *
 * Takes the slot the reviewer preferred ('a', 'b' or 'neither'), resolves it to
 * the provider that was actually behind that slot, and only then tells the
 * browser which was which. Recording is single-shot: a trial already decided
 * cannot be re-scored, so a reviewer cannot change their answer once the
 * providers are revealed.
 *
 * Also returns the running tally, so the provider decision in Master Plan
 * §24.1 can be settled on counted preferences rather than argument.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission, RbacError } from '../../../../lib/rbac';
import { nowSql } from '../../../../lib/dates';

type Slot = 'a' | 'b' | 'neither';

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'products.manage');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const trialId = typeof body.trial_id === 'string' ? body.trial_id.trim() : '';
  const choice: Slot | null = body.choice === 'a' || body.choice === 'b' || body.choice === 'neither' ? body.choice : null;
  if (!trialId || !choice) {
    return Response.json({ error: 'trial_id and choice (a|b|neither) are required' }, { status: 400 });
  }

  const trial = await env.DB
    .prepare('SELECT id, slot_a_provider, slot_b_provider, chosen_provider FROM ai_generation_trials WHERE id = ?1')
    .bind(trialId)
    .first<{ id: string; slot_a_provider: string; slot_b_provider: string; chosen_provider: string | null }>();
  if (!trial) return Response.json({ ok: false, code: 'TRIAL_NOT_FOUND' }, { status: 404 });

  const chosenProvider = choice === 'neither'
    ? 'neither'
    : choice === 'a' ? trial.slot_a_provider : trial.slot_b_provider;

  // Single-shot: the guard on chosen_provider IS NULL means a replay (or a
  // second opinion after the reveal) cannot overwrite the original answer.
  const recorded = await env.DB
    .prepare('UPDATE ai_generation_trials SET chosen_provider = ?2, chosen_at = ?3 WHERE id = ?1 AND chosen_provider IS NULL')
    .bind(trialId, chosenProvider, nowSql())
    .run();

  const tally = await env.DB
    .prepare(
      `SELECT chosen_provider AS provider, COUNT(*) AS n
         FROM ai_generation_trials
        WHERE chosen_provider IS NOT NULL
        GROUP BY chosen_provider`,
    )
    .all<{ provider: string; n: number }>();

  return Response.json({
    ok: true,
    already_recorded: recorded.meta.changes !== 1,
    // The reveal happens here and nowhere earlier.
    slot_a_provider: trial.slot_a_provider,
    slot_b_provider: trial.slot_b_provider,
    chosen_provider: trial.chosen_provider ?? chosenProvider,
    tally: Object.fromEntries((tally.results ?? []).map((r) => [r.provider, r.n])),
  });
}
