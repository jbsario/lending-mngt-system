import PocketBase from 'pocketbase'

const pocketbaseUrl = import.meta.env.VITE_POCKETBASE_URL

if (!pocketbaseUrl) {
  console.warn(
    'Missing VITE_POCKETBASE_URL. Copy .env.example to .env and point it at your PocketBase server (e.g. http://127.0.0.1:8090 locally, or your deployed URL).'
  )
}

export const pb = new PocketBase(pocketbaseUrl)

// Keep requests from being cached/queued oddly across fast page navigation.
pb.autoCancellation(false)
