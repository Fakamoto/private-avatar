"use client"

import type React from "react"
import { useState } from "react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Globe, Mail, MessageCircle, Phone, MapPin } from "lucide-react"
import { useLanguage } from "@/app/context/language-context"

export function Footer() {
  const { t } = useLanguage()
  const currentYear = new Date().getFullYear()
  const [email, setEmail] = useState("")

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // Handle newsletter subscription logic here
    console.log("Subscribing email:", email)
    // Reset the email input
    setEmail("")
  }

  return (
    <footer className="bg-background border-t">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 py-12 md:grid-cols-4">
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t("footer.aboutTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("footer.aboutDescription")}</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-4">{t("footer.quickLinks")}</h2>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/about" className="hover:text-primary transition-colors">
                  {t("footer.aboutUs")}
                </Link>
              </li>
              <li>
                <Link href="/" className="hover:text-primary transition-colors">
                  {t("footer.courses")}
                </Link>
              </li>
              <li>
                <Link href="/blog" className="hover:text-primary transition-colors">
                  {t("footer.blog")}
                </Link>
              </li>
              <li>
                <Link href="/contact" className="hover:text-primary transition-colors">
                  {t("footer.contact")}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-4">{t("footer.legal")}</h2>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="" className="hover:text-primary transition-colors">
                  {t("footer.termsOfService")}
                </Link>
              </li>
              <li>
                <Link href="" className="hover:text-primary transition-colors">
                  {t("footer.privacyPolicy")}
                </Link>
              </li>
              <li>
                <Link href="" className="hover:text-primary transition-colors">
                  {t("footer.cookiePolicy")}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-4">{t("footer.stayUpdated")}</h2>
            <p className="text-sm text-muted-foreground mb-2">{t("footer.subscribeText")}</p>
            <form className="space-y-2" onSubmit={handleSubmit}>
              <Input
                type="email"
                placeholder={t("footer.emailPlaceholder")}
                className="w-full"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Button type="submit" className="w-full">
                {t("footer.subscribe")}
              </Button>
            </form>
          </div>
        </div>

        <div className="border-t py-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <p className="text-sm text-muted-foreground">
              © {currentYear} {t("footer.copyright")}
            </p>
            <div className="flex space-x-4">
              <a
                href="#"
                className="text-muted-foreground hover:text-primary transition-colors"
                aria-label={t("footer.website")}
              >
                <Globe size={20} />
              </a>
              <a
                href="#"
                className="text-muted-foreground hover:text-primary transition-colors"
                aria-label={t("footer.email")}
              >
                <Mail size={20} />
              </a>
              <a
                href="#"
                className="text-muted-foreground hover:text-primary transition-colors"
                aria-label={t("footer.chat")}
              >
                <MessageCircle size={20} />
              </a>
              <a
                href="#"
                className="text-muted-foreground hover:text-primary transition-colors"
                aria-label={t("footer.phone")}
              >
                <Phone size={20} />
              </a>
              <a
                href="#"
                className="text-muted-foreground hover:text-primary transition-colors"
                aria-label={t("footer.location")}
              >
                <MapPin size={20} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}

