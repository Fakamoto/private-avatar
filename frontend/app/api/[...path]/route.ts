import { type NextRequest, NextResponse } from "next/server"

// Actualiza la lógica para manejar tanto URLs absolutas como relativas
const API_BASE_URL = (() => {
  // Obtener la URL configurada o usar un valor por defecto
  const configuredUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "/api"

  console.log("Configured API URL from env:", configuredUrl)

  // Si es una URL relativa como /api, necesitamos manejarla diferente
  if (configuredUrl.startsWith("/")) {
    // En el servidor, necesitamos usar la URL interna para comunicarnos con el backend
    return process.env.INTERNAL_API_BASE_URL || "http://backend:8000"
  }

  // Si es una URL absoluta, asegurarse de que tenga un protocolo
  if (!configuredUrl.startsWith("http://") && !configuredUrl.startsWith("https://")) {
    return `http://${configuredUrl}`
  }

  return configuredUrl
})()

console.log("API proxy using base URL:", API_BASE_URL)

// Función para limpiar placeholders en la ruta
function cleanPathPlaceholders(path: string): string {
  // Primero intentar decodificar cualquier parte codificada en URL
  let decodedPath = path
  try {
    // Buscar patrones como %5Bid%5D (que es [id] codificado)
    if (path.includes("%5B") && path.includes("%5D")) {
      decodedPath = decodeURIComponent(path)
      console.log(`Decodificado path de URL: ${path} -> ${decodedPath}`)
    }
  } catch (e) {
    console.error("Error decodificando path:", e)
  }

  // Reemplazar cualquier patrón [algo] con "1"
  const cleanedPath = decodedPath.replace(/\[[^\]]+\]/g, "1")

  if (cleanedPath !== path) {
    console.warn(`⚠️ Advertencia: Se encontraron placeholders sin reemplazar en la ruta: ${path} -> ${cleanedPath}`)
  }

  return cleanedPath
}

// Actualizar la función GET para manejar mejor las rutas y depuración
export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join("/")
  const url = new URL(request.url)
  const queryString = url.search

  try {
    // Make sure we don't have a double /api prefix
    const apiPath = path.startsWith("api/") ? path.substring(4) : path

    // Añadir logs de depuración para ver exactamente qué ruta estamos procesando
    console.log("API Proxy - Procesando ruta:", path)
    console.log("API Proxy - Ruta limpia:", apiPath)
    console.log("API Proxy - Query string:", queryString)

    // Verificar si hay placeholders sin reemplazar en la ruta
    // Comprobar tanto la versión normal como la codificada
    if (apiPath.includes("[") || apiPath.includes("]") || apiPath.includes("%5B") || apiPath.includes("%5D")) {
      console.error("API Proxy - Error: La ruta contiene placeholders sin reemplazar:", apiPath)

      // En lugar de devolver un error, intentar limpiar los placeholders
      const cleanedPath = cleanPathPlaceholders(apiPath)
      console.log("API Proxy - Ruta limpiada:", cleanedPath)

      // Construct the full URL with the cleaned path
      let apiUrl: URL
      try {
        apiUrl = new URL(`${API_BASE_URL}/${cleanedPath}${queryString}`)
        console.log("API Proxy - URL completa (limpiada):", apiUrl.toString())
      } catch (urlError) {
        console.error("Error constructing URL:", urlError)
        return NextResponse.json(
          {
            error: "Invalid API URL configuration",
            details: "Please check your NEXT_PUBLIC_API_BASE_URL environment variable",
            debug: {
              API_BASE_URL,
              apiPath,
              cleanedPath,
              queryString,
              error: String(urlError),
            },
          },
          { status: 500 },
        )
      }

      console.log(`Proxying GET request to (cleaned): ${apiUrl.toString()}`)

      // Continuar con la solicitud usando la ruta limpiada
      const response = await fetch(apiUrl, {
        headers: {
          // Copy headers from the original request
          ...Object.fromEntries(request.headers),
          // But override the host header
          host: apiUrl.host,
        },
      })

      // Log the response status and headers for debugging
      console.log(`Response status (cleaned route): ${response.status} ${response.statusText}`)

      // Process the response as usual
      if (!response.ok) {
        return NextResponse.json(
          {
            error: `API returned ${response.status}`,
            path: path,
            apiPath: cleanedPath,
            fullUrl: apiUrl.toString(),
          },
          { status: response.status },
        )
      }

      // Check if the response is a binary file
      const contentType = response.headers.get("content-type")
      if (
        contentType &&
        (contentType.includes("application/vnd.openxmlformats") ||
          contentType.includes("application/octet-stream") ||
          contentType.includes("application/pdf"))
      ) {
        // For binary responses, return the raw data
        const blob = await response.blob()
        return new NextResponse(blob, {
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": response.headers.get("content-disposition") || "attachment",
          },
        })
      }

      // For JSON responses, parse and return as JSON
      try {
        const data = await response.json()
        return NextResponse.json(data)
      } catch {
        // If the response is not valid JSON, return it as text
        const text = await response.text()
        return new NextResponse(text, {
          headers: {
            "Content-Type": "text/plain",
          },
        })
      }
    }

    // Construct the full URL properly
    let apiUrl: URL
    try {
      // Remove any leading slashes from apiPath to avoid triple slashes
      const cleanApiPath = apiPath.startsWith("/") ? apiPath.substring(1) : apiPath

      // Ensure API_BASE_URL ends with a slash if it doesn't already
      const baseUrl = API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`

      apiUrl = new URL(`${baseUrl}${cleanApiPath}${queryString}`)
      console.log("API Proxy - URL completa:", apiUrl.toString())
    } catch (urlError) {
      console.error("Error constructing URL:", urlError)
      console.error("API_BASE_URL:", API_BASE_URL)
      console.error("apiPath:", apiPath)
      console.error("queryString:", queryString)

      return NextResponse.json(
        {
          error: "Invalid API URL configuration",
          details: "Please check your NEXT_PUBLIC_API_BASE_URL environment variable",
          debug: {
            API_BASE_URL,
            apiPath,
            queryString,
            error: String(urlError),
          },
        },
        { status: 500 },
      )
    }

    console.log(`Proxying GET request to: ${apiUrl.toString()}`)

    // Add a longer timeout for binary downloads
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 180000) // 3 minute timeout for downloads

    // Log the request headers for debugging
    console.log("Request headers:", Object.fromEntries(request.headers))

    // Intentar la petición con un manejo de errores mejorado
    let response
    try {
      response = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          // Copy headers from the original request
          ...Object.fromEntries(request.headers),
          // But override the host header
          host: apiUrl.host,
        },
      })
    } catch (fetchError) {
      console.error("Fetch error:", fetchError)

      // Intentar una segunda vez con un enfoque alternativo
      console.log("Retrying with alternative approach...")

      // Construir la URL manualmente sin usar URL constructor
      const manualUrl = `${API_BASE_URL}/${apiPath}${queryString}`
      console.log("Manual URL:", manualUrl)

      response = await fetch(manualUrl, {
        signal: controller.signal,
        headers: {
          // Copy headers from the original request
          ...Object.fromEntries(request.headers),
          // But override the host header
          host: new URL(API_BASE_URL).host,
        },
      })
    }

    // Clear the timeout
    clearTimeout(timeoutId)

    // Log the response status and headers for debugging
    console.log(`Response status: ${response.status} ${response.statusText}`)
    console.log("Response headers:", Object.fromEntries(response.headers))

    if (!response.ok) {
      console.error(`API error: ${response.status} ${response.statusText}`)

      // For 404 errors on slides, provide a more specific error message
      if (response.status === 404 && path.includes("/slides/")) {
        console.error("Slides not found. Path:", path)
        return NextResponse.json({ error: "Slides not found. Please generate slides first." }, { status: 404 })
      }

      // For 500 errors, try to get more details
      if (response.status === 500) {
        try {
          const errorData = await response.json()
          console.error("Server error details:", errorData)
          return NextResponse.json(
            {
              error: `API returned ${response.status}`,
              detail: errorData.detail || "Unknown server error",
              path: path,
              apiPath: apiPath,
              fullUrl: apiUrl.toString(),
            },
            { status: response.status },
          )
        } catch (e) {
          console.error("Could not parse error response:", e)
        }
      }

      return NextResponse.json(
        {
          error: `API returned ${response.status}`,
          path: path,
          apiPath: apiPath,
          fullUrl: apiUrl.toString(),
        },
        { status: response.status },
      )
    }

    // Check if the response is a binary file (like PPTX)
    const contentType = response.headers.get("content-type")
    if (
      contentType &&
      (contentType.includes("application/vnd.openxmlformats") ||
        contentType.includes("application/octet-stream") ||
        contentType.includes("application/pdf"))
    ) {
      // For binary responses, return the raw data
      const blob = await response.blob()

      console.log(`Returning binary response with content type: ${contentType}`)
      console.log(`Content-Disposition: ${response.headers.get("content-disposition")}`)
      console.log(`Blob size: ${blob.size} bytes`)

      // Make sure we're setting all the necessary headers
      const headers = new Headers()
      headers.set("Content-Type", contentType)

      if (response.headers.get("content-disposition")) {
        headers.set("Content-Disposition", response.headers.get("content-disposition") || "attachment")
      } else {
        // If no content-disposition header, create one based on the path
        const filename = apiPath.split("/").pop() || "download"
        headers.set("Content-Disposition", `attachment; filename="${filename}"`)
      }

      // Set content length if available
      if (blob.size) {
        headers.set("Content-Length", blob.size.toString())
      }

      return new NextResponse(blob, { headers })
    }

    // For JSON responses, parse and return as JSON
    try {
      const data = await response.json()
      return NextResponse.json(data)
    } catch {
      // If the response is not valid JSON, return it as text
      const text = await response.text()
      return new NextResponse(text, {
        headers: {
          "Content-Type": "text/plain",
        },
      })
    }
  } catch (error) {
    console.error("API proxy error:", error)
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "Request timed out" }, { status: 504 })
    }
    return NextResponse.json(
      {
        error: "Failed to fetch data from API",
        details: error instanceof Error ? error.message : String(error),
        path: path,
        debug: {
          API_BASE_URL,
          path,
          error: String(error),
        },
      },
      { status: 500 },
    )
  }
}

// Add HEAD handler to handle head requests by redirecting to GET
export async function HEAD(request: NextRequest, { params }: { params: { path: string[] } }) {
  console.log(`HEAD request received, redirecting to GET handler for: ${params.path.join('/')}`)
  return GET(request, { params })
}

// También actualizar las funciones POST, PUT y DELETE de manera similar...
export async function POST(request: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join("/")

  try {
    // Make sure we don't have a double /api prefix
    const apiPath = path.startsWith("api/") ? path.substring(4) : path

    // Verificar si hay placeholders sin reemplazar en la ruta
    let cleanedPath = apiPath
    if (apiPath.includes("[") || apiPath.includes("]")) {
      console.error("API Proxy - Error: La ruta contiene placeholders sin reemplazar:", apiPath)
      cleanedPath = cleanPathPlaceholders(apiPath)
      console.log("API Proxy - Ruta limpiada:", cleanedPath)
    }

    // Clone the request to read the body
    const clonedRequest = request.clone()
    let body: string | FormData | Record<string, unknown>

    // Try to parse the body as JSON, but handle other content types
    const contentType = request.headers.get("content-type") || ""

    if (contentType.includes("application/json")) {
      body = await clonedRequest.json()
    } else if (contentType.includes("multipart/form-data")) {
      body = await clonedRequest.formData()
    } else {
      body = await clonedRequest.text()
    }

    // Construct the full URL properly
    let apiUrl: URL
    try {
      // Remove any leading slashes from apiPath to avoid triple slashes
      const cleanApiPath = apiPath.startsWith("/") ? apiPath.substring(1) : apiPath

      // Ensure API_BASE_URL ends with a slash if it doesn't already
      const baseUrl = API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`

      apiUrl = new URL(`${baseUrl}${cleanApiPath}`)
    } catch (urlError) {
      console.error("Error constructing URL:", urlError)
      console.error("API_BASE_URL:", API_BASE_URL)
      console.error("apiPath:", cleanedPath)

      return NextResponse.json(
        {
          error: "Invalid API URL configuration",
          details: "Please check your NEXT_PUBLIC_API_BASE_URL environment variable",
        },
        { status: 500 },
      )
    }

    console.log(`Proxying POST request to: ${apiUrl.toString()}`)

    // Prepare headers for the request to the API
    const headers: HeadersInit = {}
    request.headers.forEach((value, key) => {
      // Copy all headers except host
      if (key.toLowerCase() !== "host") {
        headers[key] = value
      }
    })

    // Make the request to the API
    let response
    if (contentType.includes("multipart/form-data")) {
      // For form data, pass the FormData object directly
      response = await fetch(apiUrl, {
        method: "POST",
        body: body as FormData,
      })
    } else if (contentType.includes("application/json")) {
      // For JSON, stringify the body
      response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      })
    } else {
      // For other content types, pass the body as is
      response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: body as string,
      })
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`API error (${response.status}): ${errorText}`)
      return NextResponse.json({ error: `API returned ${response.status}: ${errorText}` }, { status: response.status })
    }

    // Check if the response is a binary file
    const responseContentType = response.headers.get("content-type")
    if (
      responseContentType &&
      (responseContentType.includes("application/vnd.openxmlformats") ||
        responseContentType.includes("application/octet-stream") ||
        responseContentType.includes("application/pdf"))
    ) {
      // For binary responses, return the raw data
      const blob = await response.blob()
      return new NextResponse(blob, {
        headers: {
          "Content-Type": responseContentType,
          "Content-Disposition": response.headers.get("content-disposition") || "attachment",
        },
      })
    }

    // For JSON responses, parse and return as JSON
    try {
      const data = await response.json()
      return NextResponse.json(data)
    } catch {
      // If the response is not valid JSON, return it as text
      const text = await response.text()
      if (!text) {
        // If the response is empty, return a 204 No Content
        return new NextResponse(null, { status: 204 })
      }
      return new NextResponse(text, {
        headers: {
          "Content-Type": "text/plain",
        },
      })
    }
  } catch (error) {
    console.error("API proxy error:", error)
    return NextResponse.json(
      {
        error: "Failed to post data to API",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

// Update PUT and DELETE methods similarly...
export async function PUT(request: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join("/")

  try {
    // Make sure we don't have a double /api prefix
    const apiPath = path.startsWith("api/") ? path.substring(4) : path

    // Verificar si hay placeholders sin reemplazar en la ruta
    let cleanedPath = apiPath
    if (apiPath.includes("[") || apiPath.includes("]")) {
      console.error("API Proxy - Error: La ruta contiene placeholders sin reemplazar:", apiPath)
      cleanedPath = cleanPathPlaceholders(apiPath)
      console.log("API Proxy - Ruta limpiada:", cleanedPath)
    }

    // Clone the request to read the body
    const clonedRequest = request.clone()
    let body: string | FormData | Record<string, unknown>

    // Try to parse the body as JSON, but handle other content types
    const contentType = request.headers.get("content-type") || ""

    if (contentType.includes("application/json")) {
      body = await clonedRequest.json()
    } else if (contentType.includes("multipart/form-data")) {
      body = await clonedRequest.formData()
    } else {
      body = await clonedRequest.text()
    }

    // Construct the full URL properly
    let apiUrl: URL
    try {
      // Remove any leading slashes from apiPath to avoid triple slashes
      const cleanApiPath = apiPath.startsWith("/") ? apiPath.substring(1) : apiPath

      // Ensure API_BASE_URL ends with a slash if it doesn't already
      const baseUrl = API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`

      apiUrl = new URL(`${baseUrl}${cleanApiPath}`)
    } catch (urlError) {
      console.error("Error constructing URL:", urlError)
      return NextResponse.json(
        {
          error: "Invalid API URL configuration",
          details: "Please check your NEXT_PUBLIC_API_BASE_URL environment variable",
        },
        { status: 500 },
      )
    }

    console.log(`Proxying PUT request to: ${apiUrl.toString()}`)

    // Prepare headers for the request to the API
    const headers: HeadersInit = {}
    request.headers.forEach((value, key) => {
      // Copy all headers except host
      if (key.toLowerCase() !== "host") {
        headers[key] = value
      }
    })

    // Make the request to the API
    let response
    if (contentType.includes("multipart/form-data")) {
      // For form data, pass the FormData object directly
      response = await fetch(apiUrl, {
        method: "PUT",
        body: body as FormData,
      })
    } else if (contentType.includes("application/json")) {
      // For JSON, stringify the body
      response = await fetch(apiUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      })
    } else {
      // For other content types, pass the body as is
      response = await fetch(apiUrl, {
        method: "PUT",
        headers,
        body: body as string,
      })
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`API error (${response.status}): ${errorText}`)
      return NextResponse.json({ error: `API returned ${response.status}: ${errorText}` }, { status: response.status })
    }

    // Check if the response is a binary file
    const responseContentType = response.headers.get("content-type")
    if (
      responseContentType &&
      (responseContentType.includes("application/vnd.openxmlformats") ||
        responseContentType.includes("application/octet-stream") ||
        responseContentType.includes("application/pdf"))
    ) {
      // For binary responses, return the raw data
      const blob = await response.blob()
      return new NextResponse(blob, {
        headers: {
          "Content-Type": responseContentType,
          "Content-Disposition": response.headers.get("content-disposition") || "attachment",
        },
      })
    }

    // For JSON responses, parse and return as JSON
    try {
      const data = await response.json()
      return NextResponse.json(data)
    } catch {
      // If the response is not valid JSON, return it as text
      const text = await response.text()
      if (!text) {
        // If the response is empty, return a 204 No Content
        return new NextResponse(null, { status: 204 })
      }
      return new NextResponse(text, {
        headers: {
          "Content-Type": "text/plain",
        },
      })
    }
  } catch (error) {
    console.error("API proxy error:", error)
    return NextResponse.json(
      {
        error: "Failed to update data in API",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path.join("/")

  try {
    // Make sure we don't have a double /api prefix
    const apiPath = path.startsWith("api/") ? path.substring(4) : path

    // Verificar si hay placeholders sin reemplazar en la ruta
    let cleanedPath = apiPath
    if (apiPath.includes("[") || apiPath.includes("]")) {
      console.error("API Proxy - Error: La ruta contiene placeholders sin reemplazar:", apiPath)
      cleanedPath = cleanPathPlaceholders(apiPath)
      console.log("API Proxy - Ruta limpiada:", cleanedPath)
    }

    // Construct the full URL properly
    let apiUrl: URL
    try {
      // Remove any leading slashes from apiPath to avoid triple slashes
      const cleanApiPath = apiPath.startsWith("/") ? apiPath.substring(1) : apiPath

      // Ensure API_BASE_URL ends with a slash if it doesn't already
      const baseUrl = API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`

      apiUrl = new URL(`${baseUrl}${cleanApiPath}`)
    } catch (urlError) {
      console.error("Error constructing URL:", urlError)
      return NextResponse.json(
        {
          error: "Invalid API URL configuration",
          details: "Please check your NEXT_PUBLIC_API_BASE_URL environment variable",
        },
        { status: 500 },
      )
    }

    console.log(`Proxying DELETE request to: ${apiUrl.toString()}`)

    const response = await fetch(apiUrl, {
      method: "DELETE",
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`API error (${response.status}): ${errorText}`)
      return NextResponse.json({ error: `API returned ${response.status}: ${errorText}` }, { status: response.status })
    }

    // For DELETE operations that don't return JSON
    if (response.headers.get("content-type")?.includes("application/json")) {
      const data = await response.json()
      return NextResponse.json(data)
    } else {
      return new NextResponse(null, { status: 200 })
    }
  } catch (error) {
    console.error("API proxy error:", error)
    return NextResponse.json(
      {
        error: "Failed to delete data from API",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
