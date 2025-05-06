"use client"

import { useState, useCallback, useRef } from "react"
import axios, { type AxiosRequestConfig, type AxiosResponse, type AxiosError } from "axios"

interface UseApiWithRetryOptions {
  maxRetries?: number
  retryDelay?: number
  onError?: (error: Error) => void
  debounceTime?: number
}

export function useApiWithRetry({
  maxRetries = 3,
  retryDelay = 1000,
  onError,
  debounceTime = 1000,
}: UseApiWithRetryOptions = {}) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Add refs to track debouncing
  const debounceTimers = useRef<Record<string, NodeJS.Timeout>>({})
  const lastRequestTimes = useRef<Record<string, number>>({})
  const pendingRequests = useRef<Record<string, boolean>>({}) // Track pending requests

  // Helper function to create a debounce key from method and URL
  const getDebounceKey = (method: string, url: string) => `${method}:${url}`

  // Improve the executeRequest function to better handle errors and logging
  const executeRequest = useCallback(
    async <T,>(
      method: "get" | "post" | "put" | "delete",
      url: string,
      config?: AxiosRequestConfig,
      retryCount = 0,
    ): Promise<AxiosResponse<T> | null> => {
      try {
        setIsLoading(true)
        setError(null)

        // Remove any /api prefix from the URL to avoid double prefixing
        const cleanUrl = url.startsWith("/api/") ? url.substring(4) : url

        // Create a debounce key for this request
        const debounceKey = getDebounceKey(method, cleanUrl)

        // Check if we've made this request recently
        const now = Date.now()
        const lastRequestTime = lastRequestTimes.current[debounceKey] || 0

        // If we've made this request recently, throttle it
        if (now - lastRequestTime < debounceTime && retryCount === 0) {
          console.log(`Throttling ${method.toUpperCase()} request to: ${cleanUrl} - too soon since last request`)
          setIsLoading(false)
          return null
        }

        // Check if there's already a pending request for this URL
        if (pendingRequests.current[debounceKey] && retryCount === 0) {
          console.log(`Skipping duplicate ${method.toUpperCase()} request to: ${cleanUrl} - request already in progress`)
          setIsLoading(false)
          return null
        }

        // Mark this request as pending
        pendingRequests.current[debounceKey] = true

        // Update the last request time
        lastRequestTimes.current[debounceKey] = now

        console.log(
          `Executing ${method.toUpperCase()} request to: ${cleanUrl} (Attempt ${retryCount + 1}/${maxRetries + 1})`,
        )

        let response: AxiosResponse<T>

        // Log the full URL being requested
        const fullUrl = `${process.env.NEXT_PUBLIC_API_BASE_URL}/${cleanUrl}`.replace(/\/+/g, "/").replace(":/", "://")
        const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL
        console.log(`API_BASE_URL: ${API_BASE_URL}`)
        console.log(`Making request to: ${fullUrl}`)

        switch (method) {
          case "get":
            response = await axios.get<T>(cleanUrl, config)
            break
          case "post":
            response = await axios.post<T>(cleanUrl, config?.data, config)
            break
          case "put":
            response = await axios.put<T>(cleanUrl, config?.data, config)
            break
          case "delete":
            response = await axios.delete<T>(cleanUrl, config)
            break
          default:
            throw new Error(`Unsupported method: ${method}`)
        }

        // Log success
        if (method === "get" && response.data) {
          console.log(`Successfully fetched ${cleanUrl} with data:`, response.data)
        } else {
          console.log(`Successfully executed ${method.toUpperCase()} request to: ${cleanUrl}`)
        }

        // Clear the pending flag
        pendingRequests.current[debounceKey] = false

        return response
      } catch (err) {
        const error = err as AxiosError | Error
        const cleanUrl = url.startsWith("/api/") ? url.substring(4) : url
        const debounceKey = getDebounceKey(method, cleanUrl)

        // Log the error
        console.error(`API ${method.toUpperCase()} request failed:`, error)

        if (axios.isAxiosError(error) && error.response) {
          console.log(`Failed to ${method} ${url}: ${error.response.status} ${error.response.statusText}`)
          try {
            console.log(`Failed to get ${url}: ${JSON.stringify(error.response.data)}`)
          } catch {
            console.log(`Failed to get ${url}: ${error.response.data}`)
          }
        }

        // Check if we should retry
        if (retryCount < maxRetries) {
          console.log(`Retrying in ${retryDelay}ms... (${retryCount + 1}/${maxRetries})`)

          // Wait for the retry delay
          await new Promise((resolve) => setTimeout(resolve, retryDelay))

          // Retry the request
          return executeRequest<T>(method, url, config, retryCount + 1)
        }

        // If we've exhausted all retries, set the error and return null
        const finalError = axios.isAxiosError(error)
          ? new Error(`API request failed: ${error.message}`)
          : (error as Error)

        setError(finalError)

        if (onError) {
          onError(finalError)
        }

        // Clear the pending flag
        pendingRequests.current[debounceKey] = false

        return null
      } finally {
        setIsLoading(false)
      }
    },
    [maxRetries, retryDelay, onError, debounceTime],
  )

  // Create debounced versions of the API methods
  const debounce = useCallback(
    <T,>(method: "get" | "post" | "put" | "delete", url: string, config?: AxiosRequestConfig) => {
      // Remove any /api prefix from the URL to avoid double prefixing
      const cleanUrl = url.startsWith("/api/") ? url.substring(4) : url

      // Create a debounce key for this request
      const debounceKey = getDebounceKey(method, cleanUrl)

      // Clear any existing timer for this request
      if (debounceTimers.current[debounceKey]) {
        clearTimeout(debounceTimers.current[debounceKey])
      }

      // Create a new promise that will resolve when the debounced request is executed
      return new Promise<AxiosResponse<T> | null>((resolve) => {
        // Set a new timer for this request
        debounceTimers.current[debounceKey] = setTimeout(() => {
          // Execute the request and resolve the promise with the result
          executeRequest<T>(method, url, config).then(resolve)
        }, debounceTime)
      })
    },
    [executeRequest, debounceTime],
  )

  const get = useCallback(
    <T,>(url: string, config?: AxiosRequestConfig) => {
      return executeRequest<T>("get", url, config)
    },
    [executeRequest],
  )

  const post = useCallback(
    <T, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig<D>) => {
      return executeRequest<T>("post", url, { ...config, data })
    },
    [executeRequest],
  )

  const put = useCallback(
    <T, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig<D>) => {
      return executeRequest<T>("put", url, { ...config, data })
    },
    [executeRequest],
  )

  const del = useCallback(
    <T,>(url: string, config?: AxiosRequestConfig) => {
      return executeRequest<T>("delete", url, config)
    },
    [executeRequest],
  )

  // Add debounced versions of the API methods
  const debouncedGet = useCallback(
    <T,>(url: string, config?: AxiosRequestConfig) => {
      return debounce<T>("get", url, config)
    },
    [debounce],
  )

  const debouncedPost = useCallback(
    <T, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig<D>) => {
      return debounce<T>("post", url, { ...config, data })
    },
    [debounce],
  )

  const debouncedPut = useCallback(
    <T, D = unknown>(url: string, data?: D, config?: AxiosRequestConfig<D>) => {
      return debounce<T>("put", url, { ...config, data })
    },
    [debounce],
  )

  const debouncedDelete = useCallback(
    <T,>(url: string, config?: AxiosRequestConfig) => {
      return debounce<T>("delete", url, config)
    },
    [debounce],
  )

  return {
    isLoading,
    error,
    get,
    post,
    put,
    delete: del,
    debouncedGet,
    debouncedPost,
    debouncedPut,
    debouncedDelete,
  }
}