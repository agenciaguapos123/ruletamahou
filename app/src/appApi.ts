import type { AppState, AppUser } from './appModel'

type BootstrapResponse = {
  authenticated: boolean
  user: AppUser | null
  state: AppState | null
}

type AuthResponse = {
  user: AppUser
  state: AppState
}

type StateResponse = {
  state: AppState
}

const buildApiUrl = (path: string) => `${import.meta.env.BASE_URL}api/${path}`

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    ...init,
  })

  const rawBody = await response.text()
  let payload: unknown = null

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody)
    } catch {
      if (!response.ok) {
        throw new Error('El servidor devolvio una respuesta no valida.')
      }
    }
  }

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof (payload as { message?: unknown }).message === 'string'
        ? ((payload as { message: string }).message)
        : 'No se pudo completar la solicitud al servidor.'

    throw new Error(message)
  }

  return (payload ?? {}) as T
}

export function bootstrapSession(): Promise<BootstrapResponse> {
  return apiRequest<BootstrapResponse>('bootstrap.php')
}

export function loginWithPassword(username: string, password: string): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('auth.php', {
    method: 'POST',
    body: JSON.stringify({
      action: 'login',
      username,
      password,
    }),
  })
}

export async function logoutFromServer(): Promise<void> {
  await apiRequest<{ ok: boolean }>('auth.php', {
    method: 'POST',
    body: JSON.stringify({ action: 'logout' }),
  })
}

export async function saveRemoteAppState(state: AppState): Promise<AppState> {
  const response = await apiRequest<StateResponse>('state.php', {
    method: 'POST',
    body: JSON.stringify({ state }),
  })

  return response.state
}