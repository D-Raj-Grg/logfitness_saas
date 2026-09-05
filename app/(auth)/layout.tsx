import { Dumbbell } from 'lucide-react'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex items-center gap-2 font-semibold">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Dumbbell className="size-4" />
        </span>
        Lord of Gyms
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}
