"use client"

import { useLanguage } from "@/app/context/language-context"

interface InternationalizedTitleProps {
  translationKey: string
}

export function InternationalizedTitle({ translationKey }: InternationalizedTitleProps) {
  const { t } = useLanguage()

  return <h1 className="flex justify-center text-3xl font-bold mb-6">{t(translationKey)}</h1>
}

