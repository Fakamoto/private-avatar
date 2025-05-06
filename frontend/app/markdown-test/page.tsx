"use client"

import { useState } from "react"
import { MarkdownContent } from "@/app/components/markdown-content"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

const sampleMarkdown = `# Markdown Test

## Formatting

**Bold text** and *italic text* and ~~strikethrough~~

## Lists

* Unordered list item 1
* Unordered list item 2
  * Nested item 2.1
  * Nested item 2.2
* Unordered list item 3

1. Ordered list item 1
2. Ordered list item 2
3. Ordered list item 3

## Code

Inline \`code\` example

\`\`\`javascript
// Code block
function hello() {
  console.log("Hello, world!");
}
\`\`\`

## Tables

| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |

## Blockquotes

> This is a blockquote
> It can span multiple lines

## Links and Images

[Link to Google](https://www.google.com)

![Sample image](https://via.placeholder.com/150)

## Math (if supported)

Inline math: $E = mc^2$

Block math:

$$
\\frac{1}{n} \\sum_{i=1}^{n} x_i
$$
`

export default function MarkdownTestPage() {
  const [markdown, setMarkdown] = useState(sampleMarkdown)

  return (
    <div className="container py-8 space-y-6">
      <h1 className="text-2xl font-bold">Markdown Rendering Test</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Edit Markdown</h2>
          <Textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            className="min-h-[400px] font-mono text-sm"
          />
          <div className="flex gap-2">
            <Button onClick={() => setMarkdown(sampleMarkdown)}>Reset to Sample</Button>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Rendered Output</h2>
          <Card>
            <CardHeader>
              <CardTitle>Markdown Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <MarkdownContent content={markdown} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

