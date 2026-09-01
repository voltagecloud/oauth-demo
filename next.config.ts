import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Google profile pictures. The avatar is decorative; if the host ever changes
  // the <img> simply fails to load and the initials fallback shows instead.
  images: { remotePatterns: [{ protocol: "https", hostname: "lh3.googleusercontent.com" }] },
};

export default nextConfig;
