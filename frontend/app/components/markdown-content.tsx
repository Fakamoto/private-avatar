"use client"

import Image from "next/image"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeRaw from "rehype-raw"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism"
import "katex/dist/katex.min.css"

interface MarkdownContentProps {
  content: string
  className?: string
}

export function MarkdownContent({ content, className = "" }: MarkdownContentProps) {
  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeRaw]}
        components={{
          h1: ({ ...props }) => <h1 className="text-2xl font-bold my-4" {...props} />,
          h2: ({ ...props }) => <h2 className="text-xl font-bold my-3" {...props} />,
          h3: ({ ...props }) => <h3 className="text-lg font-bold my-2" {...props} />,
          h4: ({ ...props }) => <h4 className="text-base font-bold my-2" {...props} />,
          h5: ({ ...props }) => <h5 className="text-sm font-bold my-1" {...props} />,
          h6: ({ ...props }) => <h6 className="text-xs font-bold my-1" {...props} />,
          p: ({ ...props }) => <p className="my-2" {...props} />,
          a: ({ ...props }) => <a className="text-blue-600 hover:underline" {...props} />,
          ul: ({ ...props }) => <ul className="list-disc pl-6 my-2" {...props} />,
          ol: ({ ...props }) => <ol className="list-decimal pl-6 my-2" {...props} />,
          li: ({ ...props }) => <li className="my-1" {...props} />,
          blockquote: ({ ...props }) => (
            <blockquote className="border-l-4 border-gray-300 pl-4 italic my-2" {...props} />
          ),
          hr: ({ ...props }) => <hr className="my-4 border-t border-gray-300" {...props} />,
          // Fix for the image component to avoid nesting divs inside paragraphs
          img: ({ src, alt, ...props }) => {
            if (!src) return null

            if (src.startsWith("http")) {
              // For external URLs, use a regular img tag without div wrapper
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src || "/placeholder.svg"}
                  alt={alt || "Markdown image"}
                  className="max-w-full h-auto my-2"
                  {...props}
                />
              )
            }

            // For local images, use Next.js Image but without div wrapper
            return (
              <Image
                src={src || "/placeholder.svg"}
                alt={alt || "Markdown image"}
                width={800}
                height={600}
                className="max-w-full h-auto my-2"
                style={{ objectFit: "contain" }}
              />
            )
          },
          table: ({ ...props }) => (
            <div className="overflow-x-auto my-4">
              <table className="min-w-full divide-y divide-gray-300" {...props} />
            </div>
          ),
          thead: ({ ...props }) => <thead className="bg-gray-100" {...props} />,
          tbody: ({ ...props }) => <tbody className="divide-y divide-gray-200" {...props} />,
          tr: ({ ...props }) => <tr {...props} />,
          th: ({ ...props }) => (
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" {...props} />
          ),
          td: ({ ...props }) => <td className="px-3 py-2 whitespace-nowrap" {...props} />,
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || "")
            const inline = !match

            return !inline ? (
              <SyntaxHighlighter
                style={vscDarkPlus}
                language={match ? match[1] : ""}
                PreTag="div"
                className="rounded my-2"
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            ) : (
              <code className="bg-gray-200 rounded px-1" {...props}>
                {children}
              </code>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownContent

