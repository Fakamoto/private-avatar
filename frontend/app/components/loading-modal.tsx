"use client"

import { Dialog, DialogContent, DialogDescription } from "@/components/ui/dialog"
import { Loader2 } from "lucide-react"

interface LoadingModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  message?: string | null
}

export function LoadingModal({ open, onOpenChange, message = "Processing..." }: LoadingModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogDescription className="sr-only">Loading indicator</DialogDescription>
        <div className="flex flex-col items-center justify-center p-6 space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-center text-lg font-medium">{message}</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
