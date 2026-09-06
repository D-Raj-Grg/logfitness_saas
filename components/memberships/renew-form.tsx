'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'

import {
  loadPlansForBranch,
  renewMembership,
  type MembershipActionState,
} from '@/app/(app)/members/[id]/membership-actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { PaymentMethodFields } from '@/components/memberships/payment-method-fields'
import { Button } from '@/components/ui/button'
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
import { formatDate, formatMoney } from '@/lib/format'
import { paisaOrZero, planTerm, rupees } from '@/lib/plan-pricing'
import type { PaymentMethod } from '@/lib/members'

type Branch = { id: string; name: string }
type PlanOption = Awaited<ReturnType<typeof loadPlansForBranch>>['plans'][number]

export function RenewForm({
  memberId,
  branches,
  defaultBranchId,
  isFirstMembership,
  currentEndDate,
  onSuccess,
}: {
  memberId: string
  branches: Branch[]
  defaultBranchId: string
  isFirstMembership: boolean
  currentEndDate: string | null
  onSuccess: (message: string, document?: { href: string; label: string }) => void
}) {
  const [state, formAction, pending] = useActionState<MembershipActionState, FormData>(
    renewMembership,
    {}
  )

  const [branchId, setBranchId] = useState(defaultBranchId)
  const [plans, setPlans] = useState<PlanOption[]>([])
  const [planId, setPlanId] = useState('')
  const [loadingPlans, startLoadingPlans] = useTransition()
  const [discount, setDiscount] = useState('')
  const [paid, setPaid] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')

  useEffect(() => {
    startLoadingPlans(async () => {
      const result = await loadPlansForBranch(branchId)
      setPlans(result.plans)
      setPlanId((current) =>
        result.plans.some((plan) => plan.id === current) ? current : ''
      )
    })
  }, [branchId])

  useEffect(() => {
    if (state.success) onSuccess(state.success, state.document)
  }, [state.success, state.document, onSuccess])

  const plan = plans.find((item) => item.id === planId) ?? null
  const signupFee = plan && isFirstMembership ? plan.signup_fee_paisa : 0
  const subtotal = plan ? plan.price_paisa + signupFee : 0
  const discountPaisa = Math.min(paisaOrZero(discount), subtotal)
  const total = subtotal - discountPaisa
  const paidPaisa = Math.min(paisaOrZero(paid), total)
  const dueAfter = total - paidPaisa

  function choosePlan(nextPlanId: string) {
    setPlanId(nextPlanId)
    const next = plans.find((item) => item.id === nextPlanId)
    if (!next) return
    // The common case is paid in full at the desk, so the amount starts there
    // and the cashier only edits it for a part payment.
    const fee = isFirstMembership ? next.signup_fee_paisa : 0
    setPaid(rupees(Math.max(next.price_paisa + fee - paisaOrZero(discount), 0)))
  }

  function changeDiscount(value: string) {
    setDiscount(value)
    if (plan) {
      setPaid(rupees(Math.max(subtotal - paisaOrZero(value), 0)))
    }
  }

  const selectedBranch = branches.find((branch) => branch.id === branchId)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberId" value={memberId} />
      <AuthFormMessage error={state.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="renew-branch">Branch</Label>
          <Select name="branchId" value={branchId} onValueChange={(value) => setBranchId(String(value))}>
            <SelectTrigger id="renew-branch" className="w-full">
              <SelectValue>{selectedBranch?.name ?? 'Pick a branch'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError messages={state.fieldErrors?.branchId} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="renew-plan">Plan</Label>
          <Select
            name="planId"
            value={planId}
            onValueChange={(value) => choosePlan(String(value ?? ''))}
            disabled={loadingPlans || plans.length === 0}
          >
            <SelectTrigger id="renew-plan" className="w-full">
              <SelectValue>
                {loadingPlans
                  ? 'Loading plans...'
                  : plan
                    ? plan.name
                    : plans.length === 0
                      ? 'No plans sold here'
                      : 'Pick a plan'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {plans.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} · {planTerm(item)} · {formatMoney(item.price_paisa)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError messages={state.fieldErrors?.planId} />
        </div>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="renew-start">Start date (optional)</Label>
          <Input id="renew-start" name="startDate" type="date" />
          <p className="text-xs text-muted-foreground">
            {currentEndDate
              ? `Leave blank to start the day after the current plan ends (${formatDate(currentEndDate)}).`
              : 'Leave blank to start today.'}
          </p>
          <FieldError messages={state.fieldErrors?.startDate} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="renew-discount">Discount (NPR)</Label>
          <Input
            id="renew-discount"
            name="discountPaisa"
            type="number"
            inputMode="decimal"
            min={0}
            step="1"
            value={discount}
            onChange={(event) => changeDiscount(event.target.value)}
            placeholder="0"
          />
          <FieldError messages={state.fieldErrors?.discountPaisa} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="renew-paid">Paid now (NPR)</Label>
          <Input
            id="renew-paid"
            name="amountPaidPaisa"
            type="number"
            inputMode="decimal"
            min={0}
            step="1"
            value={paid}
            onChange={(event) => setPaid(event.target.value)}
            placeholder="0"
          />
          <FieldError messages={state.fieldErrors?.amountPaidPaisa} />
        </div>

        <PaymentMethodFields
          idPrefix="renew"
          method={method}
          onMethodChange={setMethod}
          referenceRequired={paidPaisa > 0}
          fieldErrors={state.fieldErrors}
        />

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="renew-notes">Notes (optional)</Label>
          <Textarea id="renew-notes" name="notes" rows={2} maxLength={2000} />
          <FieldError messages={state.fieldErrors?.notes} />
        </div>
      </div>

      <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
        {plan ? (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {plan.name}
                {signupFee > 0 ? ` + joining fee ${formatMoney(signupFee)}` : ''}
                {discountPaisa > 0 ? ` − discount ${formatMoney(discountPaisa)}` : ''}
              </span>
              <span className="font-medium">Total {formatMoney(total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Due after payment</span>
              <span className={dueAfter > 0 ? 'font-semibold text-destructive' : 'font-medium'}>
                {formatMoney(dueAfter)}
              </span>
            </div>
          </>
        ) : (
          <span className="text-muted-foreground">Pick a plan to see the total.</span>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !plan}>
          {pending ? 'Saving...' : 'Sell membership'}
        </Button>
      </div>
    </form>
  )
}
