/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "motion",
      "three",
      "@react-three/drei",
      "@react-three/fiber",
    ],
  },
};

export default nextConfig;
