"use client"

import type React from "react"
import { forwardRef } from "react"
import { cn } from "@/lib/utils"

interface SimpleScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
  children: React.ReactNode
  maxHeight?: string
}

export const SimpleScrollArea = forwardRef<HTMLDivElement, SimpleScrollAreaProps>(
  ({ className, children, maxHeight, ...props }, ref) => {
    const style: React.CSSProperties | undefined = maxHeight ? { maxHeight, overflowY: "auto" } : undefined

    return (
      <div ref={ref} className={cn("relative overflow-auto", className)} style={style} {...props}>
        <div className="h-full w-full">{children}</div>
      </div>
    )
  },
)

SimpleScrollArea.displayName = "SimpleScrollArea"
