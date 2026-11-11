/** 루트 주소(https://heukseoknews.github.io/)에 배포하므로 basePath 는 쓰지 않는다. 채널은 /<채널>/ 경로(app/[channel]). */
/** @type {import('next').NextConfig} */
export default {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
};
