import axios, { AxiosError, type AxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'

export const TOKEN_KEY = 'wms-token'

/** 生成请求唯一 ID（优先浏览器原生 UUID） */
export function genRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const http = axios.create({
  baseURL: '/api',
  timeout: 15000
})

http.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  // 离线任务重放必须沿用稳定任务号，不能每次生成新的幂等键。
  config.headers['X-Request-Id'] =
    config.headers['X-Request-Id'] || config.headers['X-Task-No'] || genRequestId()
  return config
})

/** 统一错误提示（调用方可传 config.silent = true 关闭） */
function toastError(err: AxiosError<any>) {
  const cfg = err.config as (AxiosRequestConfig & { silent?: boolean }) | undefined
  if (cfg?.silent) return
  const msg =
    err.response?.data?.message ||
    (err.code === 'ECONNABORTED' ? '请求超时，请重试' : '网络异常，请稍后重试')
  ElMessage.error(Array.isArray(msg) ? msg[0] : String(msg))
}

http.interceptors.response.use(
  (res) => res,
  async (err: AxiosError<any>) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem('wms-user')
      if (!location.pathname.startsWith('/login')) {
        const { default: router } = await import('@/router')
        router.push({ path: '/login', query: { redirect: location.pathname } })
      }
      ElMessage.error('登录已过期，请重新登录')
      return Promise.reject(err)
    }
    toastError(err)
    return Promise.reject(err)
  }
)

export default http
