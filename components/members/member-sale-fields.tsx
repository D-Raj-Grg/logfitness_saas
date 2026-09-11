'use client'

import { useEffect, useRef, useState, useTransition } from 'react'

import { loadPlansForBranch } from '@/app/(app)/members/[id]/membership-actions'
import { FieldError } from '@/components/auth/auth-form-message'
import { PaymentMethodFields } from '@/components/memberships/payment-method-fields'
import {
  PaymentStatusChoice,
  type PaymentStatus,
} from '@/components/memberships/payment-status-choice'
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
import {
  DISCOUNT_REASONS,
  DISCOUNT_REASON_LABELS,
  type DiscountReason,
  type PaymentMethod,
} from '@/lib/members'
import { paisaOrZero, planTerm, rupees, signupFeeSplit } from '@/lib/plan-pricing'

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
  const [standardFee, setStandardFee] = useState(0)
  const [planId, setPlanId] = useState('')
  const [discount, setDiscount] = useState('')
  const [discountReason, setDiscountReason] = useState<DiscountReason | ''>('')
  const [discountNote, setDiscountNote] = useState('')
  const [paid, setPaid] = useState('')
  const [payment, setPayment] = useState<PaymentStatus>('full')
  const [startDate, setStartDate] = useState('')
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
      setStandardFee(result.standardSignupFeePaisa)
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
      if (created && payment === 'full') {
        setPaid(rupees(Math.max(created.price_paisa + created.signup_fee_paisa, 0)))
      }
    })
    // `payment` is read inside the transaction but deliberately not a
    // dependency: changing it must not refetch the plan list, and choosePayment
    // already rewrites the amount when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, selling, plansVersion])

  const plan = plans.find((item) => item.id === planId) ?? null

  // A member being registered has never paid a joining fee, so it always
  // applies -- no need for the renew form's isFirstMembership flag.
  const fee = signupFeeSplit({
    planSignupFeePaisa: plan?.signup_fee_paisa ?? 0,
    orgStandardFeePaisa: standardFee,
    isFirstMembership: true,
  })
  const subtotal = plan ? plan.price_paisa + plan.signup_fee_paisa : 0
  const discountPaisa = Math.min(paisaOrZero(discount), subtotal)
  const total = subtotal - discountPaisa
  const paidPaisa = payment === 'unpaid' ? 0 : Math.min(paisaOrZero(paid), total)
  const dueAfter = total - paidPaisa

  /** The full price of a plan after a discount -- what "paid in full" means. */
  function fullAmount(
    target: PlanOption | null | undefined,
    discountValue: string
  ) {
    if (!target) return ''
    return rupees(
      Math.max(
        target.price_paisa + target.signup_fee_paisa - paisaOrZero(discountValue),
        0
      )
    )
  }

  function choosePlan(nextPlanId: string) {
    setPlanId(nextPlanId)
    const next = plans.find((item) => item.id === nextPlanId)
    if (!next) return
    // Paid in full at the desk is the common case, so the amount starts there
    // and the cashier only edits it for a part payment.
    if (payment === 'full') setPaid(fullAmount(next, discount))
  }

  function changeDiscount(value: string) {
    setDiscount(value)
    if (payment === 'full') setPaid(fullAmount(plan, value))
  }

  /**
   * The amount follows the choice rather than the other way round: full refills
   * it, unpaid empties it, and part leaves whatever is there for the cashier to
   * correct -- so switching back and forth never leaves a stale number behind.
   */
  function choosePayment(next: PaymentStatus) {
    setPayment(next)
    if (next === 'full') setPaid(fullAmount(plan, discount))
    if (next === 'unpaid') setPaid('')
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
              ? `Sold at ${branchName ?? 'this branch'}. The joining fee is added automatically.`
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
            <Label htmlFor="saleStartDate">Starts on</Label>
            <Input
              id="saleStartDate"
              name="saleStartDate"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to start today. A future date registers them now and
              holds the plan until it comes round.
            </p>
            <FieldError messages={fieldErrors?.startDate} />
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

          {/* Only once money is actually coming off. An empty reason select
              sitting beside an empty amount is a question nobody asked. */}
          {discountPaisa > 0 ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="saleDiscountReason">Reason for the discount</Label>
              <Select
                name="saleDiscountReason"
                value={discountReason}
                onValueChange={(value) => setDiscountReason(value as DiscountReason)}
              >
                <SelectTrigger id="saleDiscountReason" className="w-full">
                  <SelectValue>
                    {discountReason
                      ? DISCOUNT_REASON_LABELS[discountReason]
                      : 'Pick a reason'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DISCOUNT_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {DISCOUNT_REASON_LABELS[reason]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError messages={fieldErrors?.discountReason} />
            </div>
          ) : null}

          {discountPaisa > 0 && discountReason === 'other' ? (
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="saleDiscountNote">Describe the reason</Label>
              <Input
                id="saleDiscountNote"
                name="saleDiscountNote"
                maxLength={120}
                placeholder="Prints on the invoice"
                value={discountNote}
                onChange={(event) => setDiscountNote(event.target.value)}
              />
              <FieldError messages={fieldErrors?.discountNote} />
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label>Payment</Label>
            <PaymentStatusChoice
              value={payment}
              onChange={choosePayment}
              idPrefix="sale"
            />
          </div>

          {payment === 'unpaid' ? (
            // Nothing is mounted, so nothing is submitted: the RPC raises the
            // invoice with the full amount outstanding and the profile shows the
            // due the moment the desk lands on it.
            <p className="text-sm text-muted-foreground sm:col-span-2">
              The invoice is raised in full and the whole amount shows as due.
              Record the payment from their profile when it comes in.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="saleAmountPaidPaisa">Paid now (NPR)</Label>
                <Input
                  id="saleAmountPaidPaisa"
                  name="saleAmountPaidPaisa"
                  inputMode="decimal"
                  placeholder="0"
                  readOnly={payment === 'full'}
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
            </>
          )}

          {plan ? (
            <dl className="flex flex-col gap-1 rounded-lg bg-muted/40 p-3 text-sm sm:col-span-2">
              <div className="flex justify-between">
                <dt>{plan.name}</dt>
                <dd className="tabular-nums">{formatMoney(plan.price_paisa)}</dd>
              </div>
              {fee.charged > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <dt>Joining fee</dt>
                  <dd className="tabular-nums">{formatMoney(fee.charged)}</dd>
                </div>
              ) : null}
              {/* The waiver is a memo, not a discount: it nets to nothing and
                  leaves the total alone. It is shown so the desk can say out
                  loud what the invoice will print. */}
              {fee.waived > 0 ? (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <dt>Joining fee</dt>
                    <dd className="tabular-nums">{formatMoney(fee.waived)}</dd>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <dt>Joining fee waived</dt>
                    <dd className="tabular-nums">-{formatMoney(fee.waived)}</dd>
                  </div>
                </>
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
