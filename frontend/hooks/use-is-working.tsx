"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { toast } from "sonner"

interface UseIsWorkingOptions {
  courseId: number
  onComplete?: () => void
  onError?: (error: Error) => void
}

export function useIsWorking({ courseId, onComplete, onError }: UseIsWorkingOptions) {
  // Estados básicos
  const [isWorking, setIsWorking] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [taskMessage, setTaskMessage] = useState<string | null>(null)
  const [error, setError] = useState<Error | null>(null)

  // Referencias para evitar problemas con efectos
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const completionCallbackFiredRef = useRef(false)
  const isPollingRef = useRef(false)

  // Función para limpiar el intervalo de polling
  const cleanupPolling = useCallback(() => {
    // console.log("Limpiando intervalo de polling")
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
    isPollingRef.current = false
  }, [])

  // Función para ejecutar el callback de finalización
  const executeCompletionCallback = useCallback(() => {
    if (!completionCallbackFiredRef.current && onComplete) {
      // console.log("Ejecutando callback de finalización")
      completionCallbackFiredRef.current = true
      try {
        onComplete()
      } catch (error) {
        console.error("Error en callback de finalización:", error)
      }
    }
  }, [onComplete])

  // Función para iniciar el polling
  const startPolling = useCallback(() => {
    // Evitar iniciar múltiples ciclos de polling
    if (isPollingRef.current) {
      console.log("Ya hay un polling en curso, no iniciando otro")
      return
    }

    // console.log("Iniciando polling para verificar estado de tarea")
    setIsWorking(true)
    setIsLoading(true)
    isPollingRef.current = true
    completionCallbackFiredRef.current = false

    // Esperar 1 segundo antes de iniciar el polling
    setTimeout(() => {
      // Verificar si la tarea sigue en progreso
      const checkTaskStatus = async () => {
        try {
          // console.log(`Verificando si el curso ${courseId} está en proceso...`)

          // Usar fetch con la ruta relativa para aprovechar el proxy de API
          const response = await fetch(`/api/courses/${courseId}/is-working`)

          if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`)
          }

          const data = await response.json()
          const stillWorking = data.is_working
          // console.log(`Curso ${courseId} en proceso: ${stillWorking}`)

          // Si la tarea ha terminado
          if (!stillWorking) {
            console.log("Tarea completada")
            setIsWorking(false)
            setIsLoading(false)
            cleanupPolling()
            executeCompletionCallback()
          }
        } catch (error) {
          console.error("Error verificando estado de tarea:", error)
          // No detenemos el polling por errores temporales
        }
      }

      // Verificar inmediatamente
      checkTaskStatus()

      // Configurar intervalo de polling (cada 2 segundos)
      pollingIntervalRef.current = setInterval(checkTaskStatus, 2000)

      // Configurar un timeout de seguridad (5 minutos)
      setTimeout(
        () => {
          if (isPollingRef.current) {
            console.log("Timeout de seguridad alcanzado (5 minutos), forzando finalización")
            setIsWorking(false)
            setIsLoading(false)
            cleanupPolling()
            executeCompletionCallback()
            toast.warning("La tarea ha excedido el tiempo máximo y se ha detenido")
          }
        },
        5 * 60 * 1000,
      )
    }, 1000) // Esperar 1 segundo antes de iniciar el polling
  }, [courseId, cleanupPolling, executeCompletionCallback])

  // Función para iniciar una tarea
  const startTask = useCallback(
    async (url: string, message: string, options: RequestInit = {}) => {
      try {
        // Limpiar cualquier tarea anterior
        cleanupPolling()

        // Configurar estado inicial
        setTaskMessage(message)
        setIsLoading(true)
        setError(null)
        completionCallbackFiredRef.current = false

        // Asegurarse de que la URL comience con /api/
        const apiUrl = url.startsWith("/api/") ? url : `/api${url.startsWith("/") ? url : `/${url}`}`

        // console.log(`Enviando solicitud de tarea a: ${apiUrl}`)

        // Realizar la solicitud POST usando fetch para aprovechar el proxy de API
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: options.body || JSON.stringify({}),
        })

        if (response.ok) {
          console.log(`Tarea iniciada correctamente`)
          // Iniciar polling inmediatamente
          startPolling()
          return true
        } else {
          const errorText = await response.text()
          throw new Error(`Error al iniciar tarea: ${response.status} - ${errorText}`)
        }
      } catch (error) {
        console.error("Error iniciando tarea:", error)
        setIsLoading(false)
        setIsWorking(false)
        setError(error instanceof Error ? error : new Error(String(error)))

        toast.error(`Error al iniciar tarea: ${error instanceof Error ? error.message : String(error)}`)

        if (onError) {
          onError(error instanceof Error ? error : new Error(String(error)))
        }

        return false
      }
    },
    [cleanupPolling, onError, startPolling],
  )

  // Función para reiniciar el estado
  const resetState = useCallback(() => {
    // console.log("Reiniciando estado")
    cleanupPolling()
    setIsWorking(false)
    setIsLoading(false)
    setError(null)
    completionCallbackFiredRef.current = false
  }, [cleanupPolling])

  // Limpiar al desmontar
  useEffect(() => {
    return () => {
      cleanupPolling()
    }
  }, [cleanupPolling])

  return {
    isWorking,
    isLoading,
    taskMessage,
    error,
    startTask,
    startPolling,
    stopPolling: cleanupPolling,
    resetState,
  }
}
