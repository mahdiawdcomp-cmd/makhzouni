import axios from "axios"

function cleanApiUrl(value: string | undefined) {
  const cleaned = value
    ?.replace(/^\uFEFF/, "")
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .trim()

  return cleaned || undefined
}

// If VITE_API_URL is set explicitly use it; otherwise route through the
// same-origin proxy on hosted builds and Docker/nginx.
export const API_BASE_URL =
  cleanApiUrl(import.meta.env.VITE_API_URL) ?? "/api"

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("inventory_token")
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("inventory_token")
      localStorage.removeItem("inventory_user")
      if (window.location.pathname !== "/login") {
        window.location.assign("/login") // FIXED
      }
    }
    return Promise.reject(error)
  },
)
