// Helper function to wrap API calls with task handling
import axios from "axios"
import { toast } from "sonner"

interface TaskOptions {
  entityId: number
  taskType: string
  onStart?: () => void
  onComplete?: () => void
  onError?: (error: string) => void
}

export async function executeTask(url: string, { entityId, taskType, onStart, onError }: TaskOptions) {
  try {
    if (onStart) onStart()
    
    // Make the POST request with headers to prevent caching
    const response = await axios.post(url, null, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })

    // Extract task ID if available in the response
    const taskId = response.data?.task_id

    // Update URL with task info for resumability
    const params = new URLSearchParams(window.location.search)
    params.set("entityId", entityId.toString())
    params.set("taskType", taskType)
    
    if (taskId) {
      params.set("taskId", taskId)
    }

    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`)

    return response.data
  } catch (err) {
    console.error("Error starting task:", err)
    const errorMessage = axios.isAxiosError(err) ? err.response?.data?.error || err.message : "Unknown error occurred"

    if (onError) onError(errorMessage)
    toast.error(errorMessage)
    return false
  }
}

