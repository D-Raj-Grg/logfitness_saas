'use client'

import { useActionState, useEffect, useState } from 'react'

import { createFee, updateFee, type FeeFormState } from '@/app/(app)/settings/fees/actions'
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
import type { FeeRow } from '@/lib/db/fees'
import {
  FEE_CHARGE_RULES,
  FEE_CHARGE_RULE_LABELS,
  type FeeChargeRule,
} from '@/lib/validation/fees'

export type FeePlan = { id: string; name: string; is_active: boolean }

/** Paisa to the rupee string a human would type; only used to prefill edits. */
function rupees(paisa: number | null | undefined) {
  return paisa ? String(paisa / 100) : ''
}

export function FeeForm({
  fee,
  plans,
  onSaved,
}: {
  fee?: FeeRow
  plans: FeePlan[]
  onSaved?: () => void
}) {
  const [state, formAction, pending] = useActionState<FeeFormState, FormData>(
    fee ? updateFee : createFee,
    {}
  )
  const [chargeRule, setChargeRule] = useState<FeeChargeRule>(fee?.charge_rule ?? 'once')
  const [allPlans, setAllPlans] = useState(fee?.all_plans ?? true)
  const [selected, setSelected] = useState<string[]>(fee?.plan_ids ?? [])
  const [isActive, setIsActive] = useState(fee?.is_active ?? true)

  useEffect(() => {
    if (state.success) onSaved?.()
  }, [state, onSaved])

  function togglePlan(planId: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, planId] : current.filter((id) => id !== planId)
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <AuthFormMessage error={state.error} notice={state.success} />
      {fee ? <input type="hidden" name="feeId" value={fee.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fee-name">Name</Label>
          <Input
            id="fee-name"
            name="name"
            defaultValue={fee?.name}
            placeholder="Registration fee"
            required
            maxLength={120}
          />
          <FieldError messages={state.fieldErrors?.name} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="fee-amount">Amount (NPR)</Label>
          <Input
            id="fee-amount"
            name="amountPaisa"
            inputMode="decimal"
            defaultValue={rupees(fee?.amount_paisa)}
            required
          />
          <FieldError messages={state.fieldErrors?.amountPaisa} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="fee-rule">When it is charged</Label>
        <Select
          name="chargeRule"
          value={chargeRule}
          onValueChange={(value) => setChargeRule(value as FeeChargeRule)}
        >
          <SelectTrigger id="fee-rule" className="w-full">
            {/* Without children the trigger shows the raw enum value. */}
            <SelectValue>{FEE_CHARGE_RULE_LABELS[chargeRule]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FEE_CHARGE_RULES.map((rule) => (
              <SelectItem key={rule} value={rule}>
                {FEE_CHARGE_RULE_LABELS[rule]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {chargeRule === 'once'
            ? 'A member pays it once. On later renewals the invoice shows it taken back off.'
            : 'Charged again on every sale and renewal.'}
        </p>
        <FieldError messages={state.fieldErrors?.chargeRule} />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Applies to</legend>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={allPlans} onCheckedChange={(checked) => setAllPlans(checked)} />
          All plans, including plans added later
        </label>
        <input type="hidden" name="allPlans" value={allPlans ? 'true' : 'false'} />

        {allPlans ? null : (
          <>
            <p className="text-sm text-muted-foreground">
              Pick the plans that carry this fee. A plan added later needs it
              ticked here.
            </p>
            <div className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-md border p-3">
              {plans.map((plan) => (
                <label key={plan.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.includes(plan.id)}
                    onCheckedChange={(checked) => togglePlan(plan.id, checked)}
                  />
                  <span className={plan.is_active ? '' : 'text-muted-foreground'}>
                    {plan.name}
                    {plan.is_active ? '' : ' (inactive)'}
                  </span>
                </label>
              ))}
            </div>
            {selected.map((id) => (
              <input key={id} type="hidden" name="planIds" value={id} />
            ))}
          </>
        )}
        <FieldError messages={state.fieldErrors?.planIds} />
      </fieldset>

      {fee ? (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isActive} onCheckedChange={(checked) => setIsActive(checked)} />
          Active (charged on new sales)
          <input type="hidden" name="isActive" value={isActive ? 'true' : 'false'} />
        </label>
      ) : null}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : fee ? 'Save fee' : 'Add fee'}
        </Button>
      </div>
    </form>
  )
}
