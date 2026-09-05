'use client'

import { useActionState, useEffect, useState } from 'react'

import { createPlan, updatePlan, type PlanFormState } from '@/app/(app)/plans/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { PlanRow } from '@/lib/db/plans'
import { PLAN_TYPE_LABELS, type PlanType } from '@/lib/members'
import type { StaffRole } from '@/lib/roles'

export type PlanBranch = { id: string; name: string }

/** Paisa to the rupee string a human would type; only used to prefill edits. */
function rupees(paisa: number | null | undefined) {
  return paisa ? String(paisa / 100) : ''
}

export function PlanForm({
  plan,
  branches,
  actorRole,
  actorBranchIds,
  onSaved,
  fixedBranchIds,
}: {
  plan?: PlanRow
  branches: PlanBranch[]
  actorRole: StaffRole
  actorBranchIds: string[]
  onSaved?: (planId?: string) => void
  /**
   * When set, the plan is scoped to exactly these branches and the picker is
   * replaced by a read-only line. The inline dialog on /members/new uses it so
   * the plan it creates is guaranteed to be on sale at the branch the member is
   * being registered into -- otherwise it would be created and then not appear
   * in the dropdown that opened it.
   */
  fixedBranchIds?: string[]
}) {
  const [state, formAction, pending] = useActionState<PlanFormState, FormData>(
    plan ? updatePlan : createPlan,
    {}
  )
  const [planType, setPlanType] = useState<PlanType>(plan?.plan_type ?? 'time')
  const [selected, setSelected] = useState<string[]>(
    fixedBranchIds ?? plan?.branch_ids ?? []
  )
  const [isActive, setIsActive] = useState(plan?.is_active ?? true)

  // Only an owner may sell a plan everywhere; everyone else picks from the
  // branches they actually work at.
  const isScoped = actorRole !== 'owner'
  const visibleBranches = isScoped
    ? branches.filter((branch) => actorBranchIds.includes(branch.id))
    : branches
  const fixedNames = fixedBranchIds
    ? branches
        .filter((branch) => fixedBranchIds.includes(branch.id))
        .map((branch) => branch.name)
        .join(', ')
    : null

  useEffect(() => {
    if (state.success) onSaved?.(state.planId)
  }, [state, onSaved])

  function toggleBranch(branchId: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, branchId] : current.filter((id) => id !== branchId)
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <AuthFormMessage error={state.error} notice={state.success} />
      {plan ? <input type="hidden" name="planId" value={plan.id} /> : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={plan?.name} required maxLength={120} />
        <FieldError messages={state.fieldErrors?.name} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          name="description"
          defaultValue={plan?.description ?? ''}
          maxLength={500}
        />
        <FieldError messages={state.fieldErrors?.description} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="planType">Plan type</Label>
          <Select
            name="planType"
            value={planType}
            onValueChange={(value) => setPlanType(value as PlanType)}
          >
            <SelectTrigger id="planType" className="w-full">
              {/* Without children the trigger shows the raw enum value. */}
              <SelectValue>{PLAN_TYPE_LABELS[planType]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PLAN_TYPE_LABELS) as PlanType[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {PLAN_TYPE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError messages={state.fieldErrors?.planType} />
        </div>

        {planType === 'session_pack' ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="sessionCount">Sessions</Label>
            <Input
              id="sessionCount"
              name="sessionCount"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              defaultValue={plan?.session_count ?? ''}
              required
            />
            <FieldError messages={state.fieldErrors?.sessionCount} />
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="durationDays">
            {planType === 'time' ? 'Duration (days)' : 'Valid for (days, optional)'}
          </Label>
          <Input
            id="durationDays"
            name="durationDays"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            defaultValue={plan?.duration_days ?? ''}
            required={planType === 'time'}
          />
          <FieldError messages={state.fieldErrors?.durationDays} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="pricePaisa">Price (NPR)</Label>
          <Input
            id="pricePaisa"
            name="pricePaisa"
            inputMode="decimal"
            defaultValue={rupees(plan?.price_paisa)}
            required
          />
          <FieldError messages={state.fieldErrors?.pricePaisa} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="signupFeePaisa">Joining fee (NPR, optional)</Label>
          <Input
            id="signupFeePaisa"
            name="signupFeePaisa"
            inputMode="decimal"
            defaultValue={rupees(plan?.signup_fee_paisa)}
          />
          <FieldError messages={state.fieldErrors?.signupFeePaisa} />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Branches</legend>
        {fixedBranchIds ? (
          <p className="text-sm text-muted-foreground">
            Sold at {fixedNames || 'the selected branch'}. Change where it is sold
            from the plan catalogue.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {isScoped
                ? 'Pick at least one of your branches.'
                : 'Leave empty to sell at every branch.'}
            </p>
            <div className="flex flex-col gap-2">
              {visibleBranches.map((branch) => (
                <label key={branch.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.includes(branch.id)}
                    onCheckedChange={(checked) => toggleBranch(branch.id, checked)}
                  />
                  {branch.name}
                </label>
              ))}
            </div>
          </>
        )}
        {selected.map((id) => (
          <input key={id} type="hidden" name="branchIds" value={id} />
        ))}
        <FieldError messages={state.fieldErrors?.branchIds} />
      </fieldset>

      {plan ? (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isActive} onCheckedChange={(checked) => setIsActive(checked)} />
          Active (on sale)
          <input type="hidden" name="isActive" value={isActive ? 'true' : 'false'} />
        </label>
      ) : null}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : plan ? 'Save plan' : 'Add plan'}
        </Button>
      </div>
    </form>
  )
}
