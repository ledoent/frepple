/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The SPA is served same-origin with the Django app (resolved Q4: same-origin
  // + JWT). In dev, proxy API + websocket calls to the Django dev server so the
  // browser keeps a single origin and cookies/JWT flow naturally.
  async rewrites() {
    const backend = process.env.FREPPLE_BACKEND || "http://localhost:8000";
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/data/:path*", destination: `${backend}/data/:path*` },
    ];
  },
};

export default nextConfig;
