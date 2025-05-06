"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FileDown } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

interface FileFormatSelectorProps {
  onDownload: (format: string) => void
  disabled?: boolean
  formats?: Array<{ id: string; label: string }>
  label?: string
}

export function FileFormatSelector({
  onDownload,
  disabled = false,
  formats = [
    { id: "pptx", label: "PowerPoint (PPTX)" },
    { id: "pdf", label: "PDF Document" },
  ],
  label = "Download",
}: FileFormatSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button disabled={disabled} className="gap-2">
          <FileDown className="h-4 w-4" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {formats.map((format) => (
          <DropdownMenuItem
            key={format.id}
            onClick={() => {
              onDownload(format.id)
              setIsOpen(false)
            }}
          >
            {format.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
