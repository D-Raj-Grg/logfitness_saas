'use client'

import { useActionState, useEffect, useState } from 'react'

import { createVisitor, type VisitorFormState } from '@/app/(app)/visitors/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
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
import type { VisitorKind } from '@/lib/db/visitors'

export type VisitorBranch = { id: string; name: string }
export type VisitorPlan = { id: string; name: string; branch_ids: string[] }

export const VISITOR_KIND_LABELS: Record<VisitorKind, string> = {
  enquiry: 'Enquiry — asked about joining',
  guest: 'Guest — trained for the day',
}

/** The value the interested-plan select uses for "they did not say". */
const NO_PLAN = 'none'

export function VisitorForm({
  branches,
  plans,
  defaultBranchId,
  today,
  onSaved,
}: {
  branches: VisitorBranch[]
  plans: VisitorPlan[]
  defaultBranchId?: string
  /** Today at the desk, resolved on the server so the default is the org's day. */
  today: string
  onSaved?: () => void
}) {
  const [state, formAction, pending] = useActionState<VisitorFormState, FormData>(
    createVisitor,
    {}
  )
  const [kind, setKind] = useState<VisitorKind>('enquiry')
  const [branchId, setBranchId] = useState(defaultBranchId ?? branches[0]?.id ?? '')
  const [planId, setPlanId] = useState(NO_PLAN)

  // A plan is only offered if it is actually on sale at the branch they walked
  // into -- an empty branch_ids means org-wide.
  const branchPlans = plans.filter(
    (plan) => plan.branch_ids.length === 0 || plan.branch_ids.includes(branchId)
  )

  useEffect(() => {
    if (state.success) onSaved?.()
  }, [state, onSaved])

  // A plan picked before the branch changed may not be sold at the new one, so
  // the selection is derived rather than reset: no effect, no cascading render.
  const selectedPlanId = branchPlans.some((plan) => plan.id === planId)
    ? planId
    : NO_PLAN

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <AuthFormMessage error={state.error} notice={state.success} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="fullName">Name</Label>
        <Input id="fullName" name="fullName" required maxLength={120} autoFocus />
        <FieldError messages={state.fieldErrors?.fullName} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">Mobile</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          required
          maxLength={32}
        />
        <FieldError messages={state.fieldErrors?.phone} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="kind">Why they came</Label>
          <Select
            name="kind"
            value={kind}
            onValueChange={(value) => setKind(value as VisitorKind)}
          >
            <SelectTrigger id="kind" className="w-full">
              {/* Without children the trigger shows the raw enum value. */}
              <SelectValue>{VISITOR_KIND_LABELS[kind]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(VISITOR_KIND_LABELS) as VisitorKind[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {VISITOR_KIND_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError messages={state.fieldErrors?.kind} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="visitedOn">Date</Label>
          {/* Defaults to today and stays editable: yesterday's walk-in gets
              written up this morning more often than anyone admits. */}
          <Input id="visitedOn" name="visitedOn" type="date" defaultValue={today} />
          <FieldError messages={state.fieldErrors?.visitedOn} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="branchId">Branch</Label>
          <Select
            name="branchId"
            value={branchId}
            onValueChange={(value) => setBranchId(String(value ?? ''))}
          >
            <SelectTrigger id="branchId" className="w-full">
              <SelectValue>
                {branches.find((branch) => branch.id === branchId)?.name ??
                  'Pick a branch'}
              </SelectValue>
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
          <Label htmlFor="interestedPlanId">Interested in (optional)</Label>
          <Select
            value={selectedPlanId}
            onValueChange={(value) => setPlanId(String(value ?? NO_PLAN))}
          >
            <SelectTrigger id="interestedPlanId" className="w-full">
              <SelectValue>
                {branchPlans.find((plan) => plan.id === selectedPlanId)?.name ??
                  'Not said'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PLAN}>Not said</SelectItem>
              {branchPlans.map((plan) => (
                <SelectItem key={plan.id} value={plan.id}>
                  {plan.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* The select cannot post an empty string, so the hidden input carries
              the real value and 'none' becomes no plan at all. */}
          <input
            type="hidden"
            name="interestedPlanId"
            value={selectedPlanId === NO_PLAN ? '' : selectedPlanId}
          />
          <FieldError messages={state.fieldErrors?.interestedPlanId} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="note">Note (optional)</Label>
        <Textarea
          id="note"
          name="note"
          rows={2}
          maxLength={1000}
          placeholder="What they asked about, when to call back."
        />
        <FieldError messages={state.fieldErrors?.note} />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Log visitor'}
      </Button>
    </form>
  )
}
