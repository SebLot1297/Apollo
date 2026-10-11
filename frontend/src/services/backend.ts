// Set VITE_API_BASE_URL at build time when the API is hosted separately.
export function backendUrl(path: string) {
  return new URL(
    path,
    import.meta.env.VITE_API_BASE_URL || window.location.origin,
  )
}
