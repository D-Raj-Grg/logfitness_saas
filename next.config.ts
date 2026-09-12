import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * Barrel-file optimization. `lucide-react` and `recharts` are on Next's
     * built-in list already, so only the Base UI primitives need naming here --
     * every shadcn component in components/ui pulls from this one entry point.
     */
    optimizePackageImports: ['@base-ui/react'],
  },
};

export default nextConfig;
