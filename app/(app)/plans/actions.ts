'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { canScopePlan } from '@/components/plans/plan-scope'
import { requireRole } from '@/lib/auth'
import { getPlan, insertPlan, updatePlan as updatePlanRow } from '@/lib/db/plans'
import type { CurrentStaff } from '@/lib/roles'
import { planIdSchema, planSchema, updatePlanSchema } from '@/lib/validation/plans'

export type PlanFormState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[]>
}

const OUT_OF_SCOPE =
  'Managers can only sell a plan at their own branches. Pick at least one.'

function planFormValues(formData: FormData) {
  return {
    name: formData.get('name'),
    description: formData.get('description') ?? undefined,
    planType: formData.get('planType'),
    // An empty number input arrives as '' which coerces to 0; null is what
    // the schema means by "not set".
    durationDays: formData.get('durationDays') || null,
    sessionCount: formData.get('sessionCount') || null,
    pricePaisa: formData.get('pricePaisa'),
    signupFeePaisa: formData.get('signupFeePaisa') ?? undefined,
    branchIds: formData.getAll('branchIds').map(String),
    isActive: formData.get('isActive') !== 'false',
  }
}

function dbErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : null
  if (code === '23505') return 'A plan with that name already exists.'
  return error instanceof Error ? error.message : 'The plan could not be saved.'
}

function revalidatePlans() {
  revalidatePath('/plans')
  revalidatePath('/members')
}

/**
 * Managers may only touch plans that already sit inside their branches. RLS
 * would silently update zero rows in that case, so the refusal is made here.
 */
async function loadPlanForActor(actor: CurrentStaff, planId: string) {
  const plan = await getPlan(planId)
  if (!plan) return { error: 'That plan could not be found.' as const }
  if (!canScopePlan(actor.role, actor.branchIds, plan.branch_ids)) {
    return { error: 'Only an owner can change a plan sold outside your branches.' as const }
  }
  return { plan }
}

export async function createPlan(
  _prevState: PlanFormState,
  formData: FormData
): Promise<PlanFormState> {
  const staff = await requireRole('owner', 'manager')

  const parsed = planSchema.safeParse(planFormValues(formData))

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  if (!canScopePlan(staff.role, staff.branchIds, parsed.data.branchIds)) {
    return { fieldErrors: { branchIds: [OUT_OF_SCOPE] } }
  }

  try {
    // org_id comes from the caller's staff record, never the form; the RLS
    // insert policy independently rejects any other org.
    await insertPlan({
      org_id: staff.orgId,
      name: parsed.data.name,
      description: parsed.data.description,
      plan_type: parsed.data.planType,
      duration_days: parsed.data.durationDays,
      session_count: parsed.data.sessionCount,
      price_paisa: parsed.data.pricePaisa,
      signup_fee_paisa: parsed.data.signupFeePaisa,
      branch_ids: parsed.data.branchIds,
      is_active: true,
    })
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePlans()
  return { success: `${parsed.data.name} was added to the catalogue.` }
}

export async function updatePlan(
  _prevState: PlanFormState,
  formData: FormData
): Promise<PlanFormState> {
  const staff = await requireRole('owner', 'manager')

  const parsed = updatePlanSchema.safeParse({
    planId: formData.get('planId'),
    ...planFormValues(formData),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  if (!canScopePlan(staff.role, staff.branchIds, parsed.data.branchIds)) {
    return { fieldErrors: { branchIds: [OUT_OF_SCOPE] } }
  }

  const existing = await loadPlanForActor(staff, parsed.data.planId)
  if ('error' in existing) return { error: existing.error }

  try {
    await updatePlanRow(parsed.data.planId, {
      name: parsed.data.name,
      description: parsed.data.description,
      plan_type: parsed.data.planType,
      duration_days: parsed.data.durationDays,
      session_count: parsed.data.sessionCount,
      price_paisa: parsed.data.pricePaisa,
      signup_fee_paisa: parsed.data.signupFeePaisa,
      branch_ids: parsed.data.branchIds,
      is_active: parsed.data.isActive,
    })
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePlans()
  return { success: 'Plan saved.' }
}

export async function setPlanActive(
  _prevState: PlanFormState,
  formData: FormData
): Promise<PlanFormState> {
  const staff = await requireRole('owner', 'manager')

  const parsed = planIdSchema
    .extend({ isActive: z.enum(['true', 'false']) })
    .safeParse({
      planId: formData.get('planId'),
      isActive: formData.get('isActive'),
    })

  if (!parsed.success) {
    return { error: 'That plan could not be updated.' }
  }

  const existing = await loadPlanForActor(staff, parsed.data.planId)
  if ('error' in existing) return { error: existing.error }

  try {
    await updatePlanRow(parsed.data.planId, {
      is_active: parsed.data.isActive === 'true',
    })
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePlans()
  return { success: 'Updated.' }
}
