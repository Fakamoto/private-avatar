import type React from "react"
declare module "react-syntax-highlighter" {
  import type { ReactNode } from "react"

  export interface SyntaxHighlighterProps {
    language?: string
    style?: Record<string, unknown>
    children?: ReactNode
    className?: string
    PreTag?: string
    [key: string]: unknown
  }

  export const Prism: React.FC<SyntaxHighlighterProps>
  export default function SyntaxHighlighter(props: SyntaxHighlighterProps): JSX.Element
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  // Define a more specific type for style objects
  type StyleObject = Record<string, Record<string, string | number>>

  export const vscDarkPlus: StyleObject
}

