import http from './http'

/**
 * 离线队列（stub，供 P21 等离线场景复用）：
 * - 请求失败（断网）时可 enqueue 暂存到 localStorage，带唯一任务号 taskNo
 * - 浏览器触发 online 事件后自动重放
 * - 幂等约定：重放请求带 X-Task-No 头，后端按任务号去重，重复提交安全
 */
export interface OfflineTask {
  taskNo: string
  url: string
  method: 'post' | 'put' | 'patch' | 'delete'
  data?: unknown
  createdAt: number
}

const QUEUE_KEY = 'wms-offline-queue'

function loadQueue(): OfflineTask[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') as OfflineTask[]
  } catch {
    return []
  }
}

function saveQueue(q: OfflineTask[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
}

export function genTaskNo(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `OFF-${Date.now()}-${rand}`
}

/** 入队一条离线任务，返回任务号 */
export function enqueue(task: Omit<OfflineTask, 'taskNo' | 'createdAt'>): string {
  const q = loadQueue()
  const taskNo = genTaskNo()
  q.push({ ...task, taskNo, createdAt: Date.now() })
  saveQueue(q)
  return taskNo
}

export function pendingCount(): number {
  return loadQueue().length
}

export function listPending(): OfflineTask[] {
  return loadQueue()
}

/** 重放队列：成功的移除，失败的保留等待下次 online */
export async function replay(): Promise<{ ok: number; fail: number }> {
  const q = loadQueue()
  if (!q.length) return { ok: 0, fail: 0 }
  const remain: OfflineTask[] = []
  let ok = 0
  for (const t of q) {
    try {
      await http.request({
        url: t.url,
        method: t.method,
        data: t.data,
        headers: { 'X-Task-No': t.taskNo }
      } as never)
      ok++
    } catch {
      remain.push(t)
    }
  }
  saveQueue(remain)
  return { ok, fail: remain.length }
}

let inited = false
/** 注册 online 自动重放（main.ts 调用一次） */
export function initOffline() {
  if (inited) return
  inited = true
  window.addEventListener('online', () => {
    void replay()
  })
}
