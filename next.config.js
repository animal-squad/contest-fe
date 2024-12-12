/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  images: {
    domains: ["cdn.goorm-ktb-013.goorm.team"], // 허용할 CDN 도메인
  },
};

module.exports = nextConfig;
