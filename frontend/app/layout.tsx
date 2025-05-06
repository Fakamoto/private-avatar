import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Navigation } from "@/app/components/navigation"
import { Toaster } from "@/components/ui/sonner"
import { Footer } from "@/app/components/footer"
import { LanguageProvider } from "@/app/context/language-context"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Course Generator",
  description: "AI-powered course generation tool",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.className} min-h-screen flex flex-col bg-background`}>
        <LanguageProvider>
          <Navigation />
          <main className="flex-1">{children}</main>
          <Footer />
          <Toaster />
        </LanguageProvider>
      </body>
    </html>
  )
}

