'use client'

import { useEffect, useRef, useState, useTransition } from 'react'

import { loadPlansForBranch } from '@/app/(app)/members/[id]/membership-actions'
import { FieldError } from '@/components/auth/auth-form-message'
import { PaymentMethodFields } from '@/components/memberships/payment-method-fields'
import { PlanDialog, type PlanFormContext } from '@/components/plans/plan-dialog'
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
import { formatMoney } from '@/lib/format'
import type { PaymentMethod } from '@/lib/members'
import { paisaOrZero, planTerm, rupees } from '@/lib/plan-pricing'

type PlanOption = Awaited<ReturnType<typeof loadPlansForBranch>>['plans'][number]

/** Not a plan id -- picking it opens the dialog instead of choosing anything. */
const ADD_PLAN = '__add_plan__'

/**
 * The optional sale on the registration form. Collapsed by default, because
 * most of the screen is the member's details and a plan is a decision the desk
 * makes second.
 *
 * The fields are conditionally rendered rather than hidden: an unmounted input
 * contributes nothing to the FormData, so "collapsed" genuinely means "register
 * only" and a half-filled sale the desk thought better of cannot be submitted
 * by accident.
 */
export function MemberSaleFields({
  branchId,
  branchName,
  planContext,
  fieldErrors,
}: {
  /** The home branch chosen in the same form. The sale follows it. */
  branchId: string
  branchName?: string
  /** Roles and branches for the inline "add a plan" dialog. */
  planContext: PlanFormContext
  fieldErrors?: Record<string, string[]>
}) {
  const [selling, setSelling] = useState(false)
  const [plans, setPlans] = useState<PlanOption[]>([])
  const [planId, setPlanId] = useState('')
  const [discount, setDiscount] = useState('')
  const [paid, setPaid] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [plansVersion, setPlansVersion] = useState(0)
  // A ref, not state: a newly created plan must not retrigger the effect that
  // is about to consume it. See the effect below for why that mattered.
  const pendingPlanId = useRef<string | null>(null)
  const [loadingPlans, startLoadingPlans] = useTransition()

  useEffect(() => {
    if (!selling || !branchId) return

    startLoadingPlans(async () => {
      const result = await loadPlansForBranch(branchId)

      // Read and clear before the updater runs. Clearing it here rather than
      // through state is what keeps this to one pass: when the pending id lived
      // in state and in the dependency array, clearing it queued a second fetch
      // whose setPlanId ran in a fresh transition -- rebased on the last
      // committed state, which still had no plan selected -- and promptly
      // overwrote the plan the dialog had just chosen.
      const justCreated = pendingPlanId.current
      pendingPlanId.current = null

      setPlans(result.plans)
      setPlanId((current) => {
        // A plan just created in the dialog wins; otherwise keep the current
        // one, unless the branch changed and it is not sold here any more.
        const target = justCreated ?? current
        return result.plans.some((plan) => plan.id === target) ? target : ''
      })

      // Picking a plan from the list prefills the amount to the full price, so
      // a plan created in the dialog has to do the same -- otherwise the one
      // route into the form leaves the cashier retyping what the other fills in.
      const created = justCreated
        ? (result.plans.find((plan) => plan.id === justCreated) ?? null)
        : null
      if (created) {
        setPaid(rupees(Math.max(created.price_paisa + created.signup_fee_paisa, 0)))
      }
    })
  }, [branchId, selling, plansVersion])

  const plan = plans.find((item) => item.id === planId) ?? null

  // A member being registered has never paid a joining fee, so it always
  // applies -- no need for the renew form's isFirstMembership flag.
  const subtotal = plan ? plan.price_paisa + plan.signup_fee_paisa : 0
  const discountPaisa = Math.min(paisaOrZero(discount), subtotal)
  const total = subtotal - discountPaisa
  const paidPaisa = Math.min(paisaOrZero(paid), total)
  const dueAfter = total - paidPaisa

  function choosePlan(nextPlanId: string) {
    setPlanId(nextPlanId)
    const next = plans.find((item) => item.id === nextPlanId)
    if (!next) return
    // Paid in full at the desk is the common case, so the amount starts there
    // and the cashier only edits it for a part payment.
    setPaid(
      rupees(
        Math.max(next.price_paisa + next.signup_fee_paisa - paisaOrZero(discount), 0)
      )
    )
  }

  function changeDiscount(value: string) {
    setDiscount(value)
    if (!plan) return
    setPaid(
      rupees(Math.max(plan.price_paisa + plan.signup_fee_paisa - paisaOrZero(value), 0))
    )
  }

  const planLabel = loadingPlans
    ? 'Loading plans...'
    : plan
      ? `${plan.name} · ${planTerm(plan)} · ${formatMoney(plan.price_paisa)}`
      : plans.length === 0
        ? 'No plans sold here yet'
        : 'Pick a plan'

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <input type="hidden" name="sellPlan" value={selling ? 'true' : 'false'} />

      <label className="flex items-start gap-3 text-sm">
        <Checkbox
          checked={selling}
          disabled={!branchId}
          onCheckedChange={(checked) => setSelling(Boolean(checked))}
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">Also sell a plan now</span>
          <span className="text-xs text-muted-foreground">
            {branchId
              ? `Starts today at ${branchName ?? 'this branch'}. The joining fee is added automatically.`
              : 'Pick a home branch first.'}
          </span>
        </span>
      </label>

      {selling ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="salePlanId">Plan</Label>
            <Select
              value={planId}
              disabled={loadingPlans}
              onValueChange={(value) => {
                const next = String(value ?? '')
                if (next === ADD_PLAN) {
                  setDialogOpen(true)
                  return
                }
                choosePlan(next)
              }}
            >
              <SelectTrigger id="salePlanId" className="w-full">
                <SelectValue>{planLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {plans.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {`${item.name} · ${planTerm(item)} · ${formatMoney(item.price_paisa)}`}
                  </SelectItem>
                ))}
                <SelectItem value={ADD_PLAN}>+ Add a new plan...</SelectItem>
              </SelectContent>
            </Select>
            <input type="hidden" name="salePlanId" value={planId} />
            <FieldError messages={fieldErrors?.planId} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="saleDiscountPaisa">Discount (NPR)</Label>
            <Input
              id="saleDiscountPaisa"
              name="saleDiscountPaisa"
              inputMode="decimal"
              placeholder="0"
              value={discount}
              onChange={(event) => changeDiscount(event.target.value)}
            />
            <FieldError messages={fieldErrors?.discountPaisa} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="saleAmountPaidPaisa">Paid now (NPR)</Label>
            <Input
              id="saleAmountPaidPaisa"
              name="saleAmountPaidPaisa"
              inputMode="decimal"
              placeholder="0"
              value={paid}
              onChange={(event) => setPaid(event.target.value)}
            />
            <FieldError messages={fieldErrors?.amountPaidPaisa} />
          </div>

          <PaymentMethodFields
            method={method}
            onMethodChange={setMethod}
            idPrefix="sale"
            referenceRequired={paidPaisa > 0}
            fieldErrors={fieldErrors}
            names={{ method: 'saleMethod', reference: 'saleReferenceNo' }}
          />

          {plan ? (
            <dl className="flex flex-col gap-1 rounded-lg bg-muted/40 p-3 text-sm sm:col-span-2">
              <div className="flex justify-between">
                <dt>{plan.name}</dt>
                <dd className="tabular-nums">{formatMoney(plan.price_paisa)}</dd>
              </div>
              {plan.signup_fee_paisa > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <dt>Joining fee</dt>
                  <dd className="tabular-nums">{formatMoney(plan.signup_fee_paisa)}</dd>
                </div>
              ) : null}
              {discountPaisa > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <dt>Discount</dt>
                  <dd className="tabular-nums">-{formatMoney(discountPaisa)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t pt-1 font-medium">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatMoney(total)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className={dueAfter > 0 ? 'text-destructive' : 'text-muted-foreground'}>
                  Due after this
                </dt>
                <dd
                  className={
                    dueAfter > 0
                      ? 'tabular-nums font-medium text-destructive'
                      : 'tabular-nums text-muted-foreground'
                  }
                >
                  {formatMoney(dueAfter)}
                </dd>
              </div>
            </dl>
          ) : null}

          {plans.length === 0 && !loadingPlans ? (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Nothing is on sale at this branch yet.{' '}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDialogOpen(true)}
              >
                Add a plan
              </Button>
            </p>
          ) : null}
        </div>
      ) : null}

      {/*
        PlanForm renders a real <form>, and this component is used inside one.
        Base UI portals the dialog to document.body, so the two are never nested
        in the DOM -- which is what makes this legal.
      */}
      <PlanDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        context={planContext}
        fixedBranchIds={branchId ? [branchId] : []}
        onCreated={(created) => {
          // createPlan revalidates /plans, but this list comes from a Server
          // Action rather than the page cache, so it has to be re-fetched.
          // Select it now rather than waiting for the refetch to hand it back.
          // The round trip through the effect is asynchronous and runs inside a
          // transition, so relying on it alone left the trigger empty; this is
          // the value the desk expects to see the instant the dialog closes.
          pendingPlanId.current = created
          setPlanId(created)
          setPlansVersion((version) => version + 1)
        }}
      />
    </div>
  )
}
