"use client"

import { Progress } from "@/components/ui/progress"
import { Loader2 } from "lucide-react"

interface DownloadProgressProps {
  isDownloading: boolean
  progress: number
  filename?: string
}

export function DownloadProgress({ isDownloading, progress, filename }: DownloadProgressProps) {
  if (!isDownloading) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-card border rounded-lg shadow-lg p-4 w-80">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="font-medium">Downloading</span>
        </div>
        <span className="text-sm text-muted-foreground">{progress}%</span>
      </div>
      <Progress value={progress} className="h-2 mb-2" />
      {filename && <p className="text-sm text-muted-foreground truncate">{filename}</p>}
    </div>
  )
}
