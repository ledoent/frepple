/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const backend = process.env.FREPPLE_BACKEND || "http://localhost:8000";
    // Dev-only: proxy the Django/engine HTTP routes the SPA calls so the browser
    // keeps one origin (cookies/JWT flow naturally). In prod these are inert —
    // nginx / the Ingress own the routing (see e2e/nginx.conf + the Helm
    // Ingress, which are the canonical routing table). NOTE: websockets
    // (/ws/...) are NOT handled here — Next rewrites don't upgrade WS; run
    // `next dev` behind the e2e nginx to exercise live progress.
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/data/:path*", destination: `${backend}/data/:path*` },
      { source: "/execute/:path*", destination: `${backend}/execute/:path*` },
      { source: "/forecast/:path*", destination: `${backend}/forecast/:path*` },
    ];
  },
};

export default nextConfig;
