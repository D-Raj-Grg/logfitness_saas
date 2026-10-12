'use client'

import { useActionState, useState } from 'react'
import { Check, Copy } from 'lucide-react'

import { registerDevice, type DeviceFormState } from '@/app/(app)/settings/devices/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/30'

/**
 * The device key, on screen for the one moment it exists in plaintext. It is
 * held only in the component state of whoever rendered it: closing the panel
 * or leaving the page loses it, and the only way back is rotating the key.
 */
export function DeviceKeyReveal({ deviceKey }: { deviceKey: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(deviceKey)
      setCopied(true)
    } catch {
      // No clipboard permission (or not a secure context): the key is still
      // selectable on screen, so the owner can copy it by hand.
      setCopied(false)
    }
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
    >
      <p className="text-sm font-medium">
        Copy this key now. It is shown once and cannot be read back later.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 font-mono text-sm break-all select-all">
          {deviceKey}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy key'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Paste it into the reader&apos;s <span className="font-mono">config.h</span> and
        flash it. Lost it? Rotate the key from the list of readers and flash the new one.
      </p>
    </div>
  )
}

export function RegisterDeviceForm({
  branches,
}: {
  branches: { id: string; name: string }[]
}) {
  const [state, formAction, pending] = useActionState<DeviceFormState, FormData>(
    registerDevice,
    {}
  )
  // The action result cannot be cleared from here, so "Done" hides the key it
  // carries instead. A later registration brings a different key and shows it.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const showKey = state.key && state.key !== dismissedKey ? state.key : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Register a reader</CardTitle>
        <CardDescription>
          A reader belongs to one branch. Members tapping a card on it are checked in
          there.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {showKey ? (
          <>
            <AuthFormMessage notice={state.success} />
            <DeviceKeyReveal deviceKey={showKey} />
            <div>
              <Button type="button" onClick={() => setDismissedKey(showKey)}>
                I have copied it
              </Button>
            </div>
          </>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            <AuthFormMessage error={state.error} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="device-name">Name</Label>
                <Input
                  id="device-name"
                  name="name"
                  placeholder="Front door"
                  maxLength={60}
                  required
                />
                <FieldError messages={state.fieldErrors?.name} />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="device-branch">Branch</Label>
                <select
                  id="device-branch"
                  name="branchId"
                  className={selectClass}
                  defaultValue={branches[0]?.id ?? ''}
                  required
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
                <FieldError messages={state.fieldErrors?.branchId} />
              </div>
            </div>

            <div>
              <Button type="submit" disabled={pending || branches.length === 0}>
                {pending ? 'Registering...' : 'Register reader'}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
