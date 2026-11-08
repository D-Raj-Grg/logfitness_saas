import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Look up a card by its printed number. Plain GET so the result URL is
 * shareable and the back button works; the org rides along as a hidden field.
 * Accepts "4", "04" or "0004" -- parseCardNo on the server does the reading.
 */
export function BalanceLookupForm({
  org,
  cardNo,
  hasResult,
}: {
  org: string
  cardNo: string
  hasResult: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{hasResult ? 'Check another card' : 'Check your membership'}</CardTitle>
        <CardDescription>Enter the number printed on your card.</CardDescription>
      </CardHeader>
      <CardContent>
        <form method="get" action="/balance" className="flex flex-col gap-3">
          <input type="hidden" name="org" value={org} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="card_no">Card number</Label>
            <Input
              id="card_no"
              name="card_no"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9 .NOno]*"
              maxLength={12}
              placeholder="0004"
              defaultValue={hasResult ? '' : cardNo}
              required
            />
          </div>
          <Button type="submit">Check balance</Button>
        </form>
      </CardContent>
    </Card>
  )
}
