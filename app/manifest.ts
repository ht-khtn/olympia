import type { MetadataRoute } from 'next'
import { BUILD_INFO } from '@/configs/generated/build-info'

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Make manifest identity/version deterministic per build.
    // `id` is a standard manifest field; changing it helps clients detect updates.
    id: `/manifest.webmanifest?v=${encodeURIComponent(BUILD_INFO.version)}`,
    name: 'Olympia — Cuộc thi tri thức',
    short_name: 'Olympia',
    description: 'Nền tảng tổ chức và điều hành các cuộc thi Olympia trực tuyến.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    theme_color: '#000000',
    background_color: '#ffffff',
    categories: ['education', 'productivity'],
    icons: [
      {
        src: '/globe.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/file.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/window.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  }
}
