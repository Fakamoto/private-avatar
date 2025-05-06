import { NextResponse } from "next/server"

const API_BASE_URL = process.env.INTERNAL_API_BASE_URL

export async function GET(
  request: Request,
  { params }: { params: { entityId: string, taskType: string } }
) {
  const { entityId, taskType } = params
  
  try {
    // Add cache control headers to prevent caching
    const response = await fetch(`${API_BASE_URL}/tasks/latest/${entityId}/${taskType}`, {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      },
      next: { revalidate: 0 } // Tell Next.js not to cache this response
    })
    
    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch task: ${response.statusText}` }, 
        { status: response.status }
      )
    }
    
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error(`Error fetching latest task for entity ${entityId} and type ${taskType}:`, error)
    return NextResponse.json(
      { error: "Failed to fetch latest task" }, 
      { status: 500 }
    )
  }
} 