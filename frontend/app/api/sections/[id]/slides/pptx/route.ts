import { NextResponse } from "next/server"

const API_BASE_URL = process.env.API_BASE_URL

// ID mapping for testing
const ID_MAPPING: Record<string, string> = {
  "14": "126",
  "87": "126",
  "129": "129", // Add any other mappings you need
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    // Await the params object
    const params = await context.params
    const id = params.id

    console.log(`Getting slide PPTX for section ${id}`)

    // Map the ID if needed
    const actualId = ID_MAPPING[id] || id
    console.log(`Using actual section ID: ${actualId}`)

    const url = `${API_BASE_URL}/sections/${actualId}/slides/pptx`
    console.log(`Fetching from URL: ${url}`)

    // Make the request to the backend
    const response = await fetch(url)
    
    if (!response.ok) {
      const status = response.status
      let message = `Error ${status}: Failed to fetch slides`
      
      if (status === 404) {
        message = "No slides found for this section. Please generate slides first."
      }
      
      throw new Error(message)
    }
    
    // Get the binary data
    const arrayBuffer = await response.arrayBuffer()
    
    // Get the Content-Disposition header directly from the response
    const contentDisposition = response.headers.get('content-disposition')
    
    // Create the response headers
    const headers = new Headers({
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Access-Control-Expose-Headers": "Content-Disposition",
    })
    
    // Only add Content-Disposition if it exists in the original response
    if (contentDisposition) {
      headers.set("Content-Disposition", contentDisposition)
    }
    
    // Return the response with the original headers
    return new NextResponse(arrayBuffer, { headers })
  } catch (error) {
    console.error("Error fetching slide PPTX:", error)
    
    const errorMessage = error instanceof Error ? error.message : "Failed to fetch slide PPTX"
    const statusCode = 500
    
    return NextResponse.json({ error: errorMessage }, { status: statusCode })
  }
}

