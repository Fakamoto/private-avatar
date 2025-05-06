"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { BookOpen, GraduationCap, Menu, PlusCircle, Settings, Users, User, X, Globe } from "lucide-react"
import { useLanguage, type LanguageCode } from "@/app/context/language-context"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import Image from "next/image"

export function Navigation() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const pathname = usePathname()
  const { language, setLanguage, t } = useLanguage()

  const navItems = [
    { name: t("nav.courses"), href: "/", icon: BookOpen },
    { name: t("nav.createCourse"), href: "/create-course", icon: PlusCircle },
    { name: t("nav.aboutUs"), href: "/about", icon: Users },
    { name: t("nav.profile"), href: "/profile", icon: User },
    { name: t("nav.settings"), href: "/settings", icon: Settings },
  ]

  const languageOptions = [
    { code: "en", name: "English", flag: "/flags/gb.svg" },
    { code: "it", name: "Italiano", flag: "/flags/it.svg" },
    { code: "es", name: "Español", flag: "/flags/es.svg" },
  ]

  return (
    <nav className="bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 justify-between">
          <div className="flex">
            <div className="flex flex-shrink-0 items-center">
              <GraduationCap className="h-8 w-8 text-primary" />
              <span className="ml-2 text-2xl font-bold text-primary">{t("app.title")}</span>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {navItems.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`inline-flex items-center px-1 pt-1 text-sm font-medium ${
                    pathname === item.href
                      ? "border-b-2 border-primary text-primary"
                      : "text-muted-foreground hover:border-b-2 hover:border-primary hover:text-primary"
                  }`}
                >
                  <item.icon className="mr-2 h-4 w-4" />
                  {item.name}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center">
            {/* Language Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="mr-2">
                  <Globe className="h-5 w-5" />
                  <span className="sr-only">Select language</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {languageOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.code}
                    onClick={() => setLanguage(option.code as LanguageCode)}
                    className={`flex items-center gap-2 ${language === option.code ? "bg-primary/10" : ""}`}
                  >
                    <Image
                      src={option.flag || "/placeholder.svg"}
                      alt={option.name}
                      width={20}
                      height={15}
                      className="rounded-sm"
                    />
                    <span>{option.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Mobile menu button */}
            <div className="sm:hidden">
              <Button
                variant="ghost"
                className="inline-flex items-center justify-center rounded-md p-2"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              >
                <span className="sr-only">Open main menu</span>
                {isMobileMenuOpen ? (
                  <X className="block h-6 w-6" aria-hidden="true" />
                ) : (
                  <Menu className="block h-6 w-6" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="sm:hidden">
          <div className="space-y-1 pb-3 pt-2">
            {navItems.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className={`block border-l-4 py-2 pl-3 pr-4 text-base font-medium ${
                  pathname === item.href
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-transparent text-muted-foreground hover:border-primary hover:bg-primary/10 hover:text-primary"
                }`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <div className="flex items-center">
                  <item.icon className="mr-2 h-4 w-4" />
                  {item.name}
                </div>
              </Link>
            ))}

            {/* Language options in mobile menu */}
            <div className="border-t border-gray-200 pt-4 pb-2">
              <p className="px-4 text-sm font-medium text-muted-foreground">Language</p>
              <div className="mt-2 space-y-1">
                {languageOptions.map((option) => (
                  <button
                    key={option.code}
                    onClick={() => {
                      setLanguage(option.code as LanguageCode)
                      setIsMobileMenuOpen(false)
                    }}
                    className={`flex w-full items-center px-4 py-2 text-base font-medium ${
                      language === option.code
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-primary/5"
                    }`}
                  >
                    <Image
                      src={option.flag || "/placeholder.svg"}
                      alt={option.name}
                      width={20}
                      height={15}
                      className="mr-3 rounded-sm"
                    />
                    {option.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}

