import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  typescript: {
    // This allows production builds to complete even with TypeScript errors
    ignoreBuildErrors: true,
  },
  // Remove the rewrites configuration as we're using the API route handler
}

export default nextConfig
