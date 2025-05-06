"use client"

import type { ReactNode } from "react"
import { useLanguage } from "@/app/context/language-context"

interface TranslatedComponentProps {
  translationKey: string
  children: ReactNode
}

export function TranslatedText({ translationKey, children }: TranslatedComponentProps) {
  const { t } = useLanguage()

  return <>{t(translationKey) || children}</>
}

