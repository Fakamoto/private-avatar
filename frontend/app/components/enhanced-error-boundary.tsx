"use client"

import { Component, type ErrorInfo, type ReactNode } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SimpleScrollArea } from "@/components/ui/scroll-area"
import { RefreshCcw, Bug } from "lucide-react"

interface EnhancedErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface EnhancedErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  showDetails: boolean
}

export class EnhancedErrorBoundary extends Component<EnhancedErrorBoundaryProps, EnhancedErrorBoundaryState> {
  constructor(props: EnhancedErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<EnhancedErrorBoundaryState> {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Error caught by ErrorBoundary:", error, errorInfo)

    // Registrar información adicional que puede ayudar a diagnosticar el problema
    console.error("Component stack:", errorInfo.componentStack)

    if (error.stack) {
      console.error("Error stack:", error.stack)
    }

    this.setState({
      error,
      errorInfo,
    })
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false })
  }

  toggleDetails = (): void => {
    this.setState((prevState) => ({ showDetails: !prevState.showDetails }))
  }

  resetError = (): void => {
    console.log("Resetting error state in ErrorBoundary")
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    })

    // Forzar una recarga de la página si es necesario
    // window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="p-4 max-w-4xl mx-auto">
          <Alert variant="destructive" className="mb-4">
            <AlertTitle className="text-lg">Something went wrong</AlertTitle>
            <AlertDescription className="text-base">
              {this.state.error?.message || "An unexpected error occurred"}
            </AlertDescription>
          </Alert>

          <div className="flex gap-2 mb-4">
            <Button onClick={this.handleRetry} className="gap-2">
              <RefreshCcw className="h-4 w-4" />
              Try Again
            </Button>

            <Button variant="outline" onClick={this.toggleDetails} className="gap-2">
              <Bug className="h-4 w-4" />
              {this.state.showDetails ? "Hide" : "Show"} Error Details
            </Button>
          </div>

          {this.state.showDetails && (
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>Error Details</CardTitle>
              </CardHeader>
              <CardContent>
                <SimpleScrollArea className="h-[300px]">
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-medium mb-1">Error Message:</h3>
                      <pre className="bg-muted p-2 rounded overflow-x-auto">
                        {this.state.error?.message || "Unknown error"}
                      </pre>
                    </div>

                    {this.state.error?.stack && (
                      <div>
                        <h3 className="font-medium mb-1">Stack Trace:</h3>
                        <pre className="bg-muted p-2 rounded overflow-x-auto text-xs">{this.state.error.stack}</pre>
                      </div>
                    )}

                    {this.state.errorInfo?.componentStack && (
                      <div>
                        <h3 className="font-medium mb-1">Component Stack:</h3>
                        <pre className="bg-muted p-2 rounded overflow-x-auto text-xs">
                          {this.state.errorInfo.componentStack}
                        </pre>
                      </div>
                    )}
                  </div>
                </SimpleScrollArea>
              </CardContent>
            </Card>
          )}

          <p className="text-muted-foreground text-sm">
            If this problem persists, please try refreshing the page or contact support.
          </p>
        </div>
      )
    }

    return this.props.children
  }
}
