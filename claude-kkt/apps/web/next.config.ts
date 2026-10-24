import type { NextConfig } from "next";

/**
 * Hosts the image optimizer may fetch from. Built from the API URLs at build time
 * (NEXT_PUBLIC_API_URL is the browser-facing host, API_INTERNAL_URL the in-cluster one),
 * with a localhost fallback for development.
 */
function remotePatternsFromEnv(): NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> {
  const candidates = [process.env.NEXT_PUBLIC_API_URL, process.env.API_INTERNAL_URL, "http://localhost:4000"];
  const seen = new Set<string>();
  const patterns: NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> = [];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      const protocol = url.protocol.replace(":", "");
      if (protocol !== "http" && protocol !== "https") continue;
      const key = `${protocol}://${url.hostname}:${url.port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      patterns.push({
        protocol,
        hostname: url.hostname,
        ...(url.port ? { port: url.port } : {}),
        pathname: "/api/v1/public/media/**",
      });
    } catch {
      // ignore malformed URLs; the build should not fail on a typo in env
    }
  }
  // Video poster thumbnails for click-to-load embeds are plain <img>, so no YouTube/Vimeo hosts here.
  return patterns;
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@kkt/contracts"],
  images: {
    remotePatterns: remotePatternsFromEnv(),
    formats: ["image/avif", "image/webp"],
    deviceSizes: [390, 640, 768, 1024, 1280, 1536, 1920],
    minimumCacheTTL: 3600,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
