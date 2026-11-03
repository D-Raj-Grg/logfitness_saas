'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ReactNode } from 'react'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type StaffTabKey = 'attendance' | 'checkins' | 'payments' | 'trainer'

export const STAFF_TAB_LABELS: Record<StaffTabKey, string> = {
  attendance: 'Attendance',
  checkins: 'Check-ins they did',
  payments: 'Payments collected',
  trainer: 'Trainer work',
}

/**
 * The tab lives in the URL (?tab=), so a filtered view can be bookmarked and
 * the date pickers -- which rewrite the query string -- do not throw the
 * reader back to the first tab. Only the open tab's panel is rendered by the
 * page, which also means only its data is fetched.
 *
 * Switching tabs drops `page`: page 3 of check-ins means nothing on payments.
 */
export function StaffActivityTabs({
  active,
  tabs,
  children,
}: {
  active: StaffTabKey
  tabs: StaffTabKey[]
  children: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function choose(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', value)
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={active} onValueChange={(value) => choose(String(value))}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="w-max">
            {tabs.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {STAFF_TAB_LABELS[tab]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>
      {children}
    </div>
  )
}
