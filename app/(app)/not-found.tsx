import Link from 'next/link'

import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
      <p className="text-sm font-medium">Not found</p>
      <p className="max-w-md text-sm text-muted-foreground">
        That record does not exist, or it belongs to another gym.
      </p>
      <Button variant="outline" size="sm" render={<Link href="/" />}>
        Back to dashboard
      </Button>
    </div>
  )
}
