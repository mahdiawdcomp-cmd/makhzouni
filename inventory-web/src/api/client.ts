import axios from "axios"

// If VITE_API_URL is set explicitly use it; otherwise derive from the page host
// so the app works from any device on the LAN (mobile, tablet, etc.)
export const API_BASE_URL =
  import.meta.env.VITE_API_URL ??
  `${window.location.protocol}//${window.location.hostname}:5000/api`

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
