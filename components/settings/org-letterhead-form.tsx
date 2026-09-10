'use client'

import { useActionState, useState } from 'react'

import {
  updateOrgLetterhead,
  type SettingsFormState,
} from '@/app/(app)/settings/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Letterhead } from '@/components/print/letterhead'
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
import { Textarea } from '@/components/ui/textarea'
import type { OrgRow } from '@/lib/db/orgs'

export function OrgLetterheadForm({
  org,
  logoUrl,
}: {
  org: OrgRow
  /** Public storage URL for the current logo, if one is set. */
  logoUrl: string | null
}) {
  const [state, formAction, pending] = useActionState<SettingsFormState, FormData>(
    updateOrgLetterhead,
    {}
  )

  const [pickedUrl, setPickedUrl] = useState<string | null>(null)
  const [removeLogo, setRemoveLogo] = useState(false)

  const preview = pickedUrl ?? (removeLogo ? null : logoUrl)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <AuthFormMessage error={state.error} notice={state.success} />

      <Card>
        <CardHeader>
          <CardTitle>Letterhead</CardTitle>
          <CardDescription>
            Printed at the top of every invoice and receipt.
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Gym name</Label>
            <Input id="name" name="name" required defaultValue={org.name} />
            <FieldError messages={state.fieldErrors?.name} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="legalName">Registered name (optional)</Label>
            <Input
              id="legalName"
              name="legalName"
              defaultValue={org.legal_name ?? ''}
              placeholder={org.name}
            />
            <p className="text-xs text-muted-foreground">
              Printed instead of the gym name when the two differ.
            </p>
            <FieldError messages={state.fieldErrors?.legalName} />
          </div>

          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="address">Address (optional)</Label>
            <Textarea id="address" name="address" defaultValue={org.address ?? ''} />
            <FieldError messages={state.fieldErrors?.address} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="phone">Phone (optional)</Label>
            <Input
              id="phone"
              name="phone"
              inputMode="tel"
              defaultValue={org.phone ?? ''}
            />
            <FieldError messages={state.fieldErrors?.phone} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email (optional)</Label>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={org.email ?? ''}
            />
            <FieldError messages={state.fieldErrors?.email} />
          </div>

          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="logo">Logo (optional)</Label>
            <div className="flex items-center gap-4">
              {preview ? (
                /* A blob preview and a public storage URL are both outside the
                   configured image domains, so next/image cannot serve either. */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt=""
                  className="h-16 w-auto max-w-[200px] shrink-0 rounded-md border bg-white object-contain p-1"
                />
              ) : (
                <span className="flex h-16 w-[100px] shrink-0 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                  None
                </span>
              )}

              <div className="flex flex-col gap-2">
                <Input
                  id="logo"
                  name="logo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    setPickedUrl(file ? URL.createObjectURL(file) : null)
                    setRemoveLogo(false)
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  JPEG, PNG, or WebP, up to 2&nbsp;MB. Prints about 16&nbsp;mm tall.
                </p>
              </div>

              {preview ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPickedUrl(null)
                    setRemoveLogo(true)
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </div>
            <input type="hidden" name="removeLogo" value={removeLogo ? 'true' : 'false'} />
            <FieldError messages={state.fieldErrors?.logo} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tax and terms</CardTitle>
          <CardDescription>Printed below the totals on every document.</CardDescription>
        </CardHeader>

        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="panNo">PAN / VAT number (optional)</Label>
            <Input id="panNo" name="panNo" defaultValue={org.pan_no ?? ''} />
            <FieldError messages={state.fieldErrors?.panNo} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="taxNote">Tax note (optional)</Label>
            <Input
              id="taxNote"
              name="taxNote"
              defaultValue={org.tax_note ?? ''}
              placeholder="VAT not applicable"
            />
            <FieldError messages={state.fieldErrors?.taxNote} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="standardSignupFee">Registration fee (NPR)</Label>
            <Input
              id="standardSignupFee"
              name="standardSignupFee"
              inputMode="decimal"
              defaultValue={String(org.standard_signup_fee_paisa / 100)}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground">
              Your list joining fee. It is never charged on its own: the fee on
              the plan is what the member pays. This is the amount an invoice
              strikes out when the fee is waived, on a renewal or on a plan
              priced without one. Leave it at 0 to print no waiver line.
            </p>
            <FieldError messages={state.fieldErrors?.standardSignupFeePaisa} />
          </div>

          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="invoiceTerms">Terms and footer (optional)</Label>
            <Textarea
              id="invoiceTerms"
              name="invoiceTerms"
              rows={4}
              defaultValue={org.invoice_terms ?? ''}
              placeholder="Fees once paid are not refundable."
            />
            <FieldError messages={state.fieldErrors?.invoiceTerms} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>
            How the masthead looks on paper. Save to refresh it.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="overflow-x-auto">
            <div className="doc-a4 !min-h-0 !w-[182mm] rounded-md border !py-6">
              <Letterhead org={org} documentTitle="Invoice" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save letterhead'}
        </Button>
      </div>
    </form>
  )
}
