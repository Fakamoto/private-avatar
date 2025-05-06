"use client"

import { useState, useCallback, useEffect } from "react"
import { toast } from "sonner"
import { saveAs } from "file-saver"
import { parse } from "content-disposition"

interface UseDownloadProgressOptions {
  onSuccess?: (filename: string) => void
  onError?: (error: Error) => void
  onProgress?: (progress: number) => void
}

export function useDownloadProgress(options: UseDownloadProgressOptions = {}) {
  const [isDownloading, setIsDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<Error | null>(null)
  
  // Destructure the callbacks to avoid dependency issues
  const { onSuccess, onError, onProgress } = options

  // Reset progress when not downloading
  useEffect(() => {
    if (!isDownloading) {
      setProgress(0)
    }
  }, [isDownloading])

  const downloadFileWithProgress = useCallback(
    async (url: string, fallbackFilename: string) => {
      setIsDownloading(true)
      setProgress(0)
      const loadingToast = toast.loading("Preparing download...")

      try {
        console.log(`Downloading file with progress from: ${url}`)

        // Build the final URL to fetch
        let finalUrl = url

        // If the URL is not absolute (doesn't start with http/https), ensure it uses the internal API proxy
        if (!/^https?:\/\//.test(url)) {
          // Remove any existing /api prefix to prevent duplicates
          const cleanPath = url.startsWith("/api/") ? url.substring(4) : url
          finalUrl = `/api${cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`}`
        }

        console.log("Final download URL:", finalUrl)

        // Use fetch with a timeout to download the file - using GET only, not HEAD first
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 180000) // 3 minute timeout
        console.log("Making direct GET request for file download (no HEAD check first)")
        
        const response = await fetch(finalUrl, {
          signal: controller.signal,
          // Explicitly set method to GET to avoid any automatic HEAD requests
          method: "GET"
        })
        
        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`Failed to download file: ${response.status} ${response.statusText}`)
        }

        // Get the content length if available
        const contentLength = response.headers.get("content-length")
        const total = contentLength ? parseInt(contentLength, 10) : 0
        console.log(`Content length: ${total} bytes`)

        // Get the content type and disposition for the file
        const contentType = response.headers.get("content-type")
        console.log(`Content type: ${contentType}`)
        
        // Extract filename from Content-Disposition header
        const contentDisposition = response.headers.get("content-disposition")
        console.log(`Content-Disposition: ${contentDisposition}`)
        
        // Parse filename from Content-Disposition header
        let filename = fallbackFilename
        if (contentDisposition) {
          try {
            // Try to extract the UTF-8 encoded filename first (filename* parameter)
            const match = contentDisposition.match(/filename\*=UTF-8''([^;"\s]+)/i)
            if (match) {
              filename = decodeURIComponent(match[1])
              console.log(`Using filename from Content-Disposition (UTF-8): ${filename}`)
            } 
            // If no UTF-8 filename found, try regular filename
            else {
              const basicMatch = contentDisposition.match(/filename="([^"]+)"/i)
              if (basicMatch) {
                filename = basicMatch[1]
                console.log(`Using filename from Content-Disposition (ASCII): ${filename}`)
              }
            }
          } catch (err) {
            console.error("Error parsing Content-Disposition header:", err)
          }
        } else {
          console.log(`No Content-Disposition header found, using fallback filename: ${fallbackFilename}`)
        }

        // Create a reader from the response body
        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error("Failed to initialize download stream")
        }

        // Read the response body in chunks
        let receivedLength = 0
        const chunks: Uint8Array[] = []

        while (true) {
          const { done, value } = await reader.read()
          
          if (done) {
            console.log("Download stream complete")
            break
          }
          
          chunks.push(value)
          receivedLength += value.length
          
          if (total > 0) {
            const newProgress = Math.round((receivedLength / total) * 100)
            setProgress(newProgress)
          }
        }

        // Combine all chunks into a single Uint8Array
        const allChunks = new Uint8Array(receivedLength)
        let position = 0
        for (const chunk of chunks) {
          allChunks.set(chunk, position)
          position += chunk.length
        }

        // Convert to blob with the appropriate content type
        const blob = new Blob([allChunks], { type: contentType || "application/octet-stream" })
        
        // Create a download link
        const downloadUrl = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = downloadUrl
        link.setAttribute("download", filename)
        link.click()
        
        // Clean up
        URL.revokeObjectURL(downloadUrl)
        
        console.log(`File downloaded successfully: ${filename}`)
        toast.dismiss(loadingToast)
        toast.success(`Downloaded: ${filename}`)
        
        if (onSuccess) {
          onSuccess(filename)
        }
        return true
      } catch (error) {
        console.error("Download error:", error)
        toast.dismiss(loadingToast)
        toast.error(`Download failed: ${error instanceof Error ? error.message : String(error)}`)
        
        if (onError) {
          onError(error instanceof Error ? error : new Error(String(error)))
        }
        return false
      } finally {
        setIsDownloading(false)
        setProgress(0)
      }
    },
    [onSuccess, onError]
  )

  return {
    isDownloading,
    progress,
    error,
    downloadFileWithProgress,
  }
}
