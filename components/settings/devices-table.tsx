'use client'

import { useActionState, useState } from 'react'

import {
  renameDevice,
  rotateDeviceKey,
  setDeviceStatus,
  type DeviceFormState,
} from '@/app/(app)/settings/devices/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { DeviceKeyReveal } from '@/components/settings/register-device-form'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { DeviceListRow } from '@/lib/db/devices'
import { formatDateTime } from '@/lib/format'

function RenameDeviceDialog({ device }: { device: DeviceListRow }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<DeviceFormState, FormData>(
    async (prev, formData) => {
      const result = await renameDevice(prev, formData)
      if (result.success) setOpen(false)
      return result
    },
    {}
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Rename</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="deviceId" value={device.id} />
          <DialogHeader>
            <DialogTitle>Rename {device.name}</DialogTitle>
            <DialogDescription>
              The attendance log shows this name for every check-in at this reader,
              past ones included.
            </DialogDescription>
          </DialogHeader>

          <AuthFormMessage error={state.error} />

          <div className="flex flex-col gap-2">
            <Label htmlFor={`device-name-${device.id}`}>Name</Label>
            <Input
              id={`device-name-${device.id}`}
              name="name"
              defaultValue={device.name}
              maxLength={60}
              required
            />
            <FieldError messages={state.fieldErrors?.name} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Replacing the key is also how a lost key is recovered: the plaintext was
 * shown once at registration and nobody, this screen included, can read it
 * back. The new key is shown inside the dialog, which stays open until the
 * owner closes it.
 */
function RotateKeyDialog({ device }: { device: DeviceListRow }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<DeviceFormState, FormData>(
    rotateDeviceKey,
    {}
  )
  // A key from an earlier rotate in this session must not reappear when the
  // dialog is reopened, so it is hidden once the dialog that showed it closes.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const showKey = state.key && state.key !== dismissedKey ? state.key : null

  function onOpenChange(next: boolean) {
    if (!next && state.key) setDismissedKey(state.key)
    setOpen(next)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        Rotate key
      </AlertDialogTrigger>
      <AlertDialogContent>
        {showKey ? (
          <div className="flex flex-col gap-4">
            <AlertDialogHeader>
              <AlertDialogTitle>New key for {device.name}</AlertDialogTitle>
              <AlertDialogDescription>{state.success}</AlertDialogDescription>
            </AlertDialogHeader>
            <DeviceKeyReveal deviceKey={showKey} />
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => onOpenChange(false)}>
                I have copied it
              </AlertDialogAction>
            </AlertDialogFooter>
          </div>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="deviceId" value={device.id} />
            <AlertDialogHeader>
              <AlertDialogTitle>Replace the key for {device.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                The key it is flashed with (starting{' '}
                <span className="font-mono">{device.key_prefix}</span>) stops working
                immediately. The reader denies every tap until it is flashed with the
                new key.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AuthFormMessage error={state.error} />

            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction type="submit" variant="destructive" disabled={pending}>
                {pending ? 'Replacing...' : 'Replace key'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

function StatusToggle({ device }: { device: DeviceListRow }) {
  const [open, setOpen] = useState(false)
  const disabling = device.status === 'active'
  const [state, formAction, pending] = useActionState<DeviceFormState, FormData>(
    async (prev, formData) => {
      const result = await setDeviceStatus(prev, formData)
      if (result.success) setOpen(false)
      return result
    },
    {}
  )

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button variant={disabling ? 'destructive' : 'outline'} size="sm" />}
      >
        {disabling ? 'Disable' : 'Enable'}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="deviceId" value={device.id} />
          <input type="hidden" name="status" value={disabling ? 'disabled' : 'active'} />
          <AlertDialogHeader>
            <AlertDialogTitle>
              {disabling ? `Disable ${device.name}?` : `Enable ${device.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {disabling
                ? 'It refuses every card until it is enabled again. Its key and its check-in history are kept.'
                : 'It starts letting members in again with the key it already has.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AuthFormMessage error={state.error} />

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="submit"
              variant={disabling ? 'destructive' : 'default'}
              disabled={pending}
            >
              {pending ? 'Working...' : disabling ? 'Disable' : 'Enable'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function DevicesTable({
  rows,
  branchNames,
}: {
  rows: DeviceListRow[]
  branchNames: Record<string, string>
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No readers yet. Register one above, then flash its key onto the reader.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Last seen</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCell className="text-muted-foreground">
                {branchNames[row.branch_id] ?? '--'}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {row.key_prefix}…
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                {row.last_seen_at ? formatDateTime(row.last_seen_at) : 'Never'}
              </TableCell>
              <TableCell>
                <Badge variant={row.status === 'active' ? 'default' : 'secondary'}>
                  {row.status === 'active' ? 'Active' : 'Disabled'}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <RenameDeviceDialog device={row} />
                  <RotateKeyDialog device={row} />
                  <StatusToggle device={row} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
