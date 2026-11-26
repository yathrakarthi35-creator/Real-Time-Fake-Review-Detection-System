/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // In local development, proxy /api/* requests to local FastAPI (uvicorn on port 8000).
    // On Vercel production, vercel.json routes /api/* directly to /api/index.py.
    if (process.env.NODE_ENV === "development") {
      return [
        {
          source: "/api/:path*",
          destination: "http://127.0.0.1:8000/api/:path*",
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
