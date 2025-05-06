"use client"

import { toast as sonnerToast, type ToastT } from "sonner"

type ToastProps = ToastT & {
  title?: string
  description?: string
}

export function toast(props: ToastProps) {
  const { title, description, ...rest } = props
  return sonnerToast(title || description || "", {
    ...rest,
    description: title ? description : undefined,
  })
}

export type { ToastProps }

export function useToast() {
  return {
    toast,
    dismiss: sonnerToast.dismiss,
  }
}

