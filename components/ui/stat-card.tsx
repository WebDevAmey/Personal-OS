import * as React from "react"

import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"

function StatCard({
  className,
  label,
  value,
  icon,
  ...props
}: React.ComponentProps<"div"> & {
  label: React.ReactNode
  value: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <Card
      data-slot="stat-card"
      className={cn("gap-2", className)}
      {...props}
    >
      <CardContent className="flex items-center gap-3">
        {icon ? (
          <span
            data-slot="stat-card-icon"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&>svg]:size-4.5"
          >
            {icon}
          </span>
        ) : null}
        <div className="flex flex-col gap-0.5">
          <span className="text-2xl leading-tight font-semibold text-foreground">
            {value}
          </span>
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
      </CardContent>
    </Card>
  )
}

export { StatCard }
