import type {
  AccountsOverview,
  Channel,
  ChannelPatch,
  ChannelUpdate,
  ChannelView,
  CleanupResult,
  Health,
  Overview,
  Run,
  RunStatus,
  StorageStatus,
  SystemCheck,
  Video,
  VideoState,
} from './types';

/** A failed request. `message` is the server's `{ error }` text when it sent one. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong.';
}

type RequestInitJson = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit };

async function request<T>(path: string, init: RequestInitJson = {}): Promise<T> {
  const { json, body, headers: rawHeaders, ...rest } = init;
  const headers = new Headers(rawHeaders);
  headers.set('Accept', 'application/json');
  let payload: BodyInit | undefined = body;
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(json);
  }

  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers, body: payload });
  } catch {
    throw new ApiError(0, "Can't reach the app server. Is it running?");
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError(res.status, `The server sent an unexpected reply (HTTP ${res.status}).`);
    }
  }

  if (!res.ok) {
    const serverMessage =
      data !== null && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : null;
    throw new ApiError(res.status, serverMessage ?? `Request failed (HTTP ${res.status}).`);
  }
  return data as T;
}

function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export interface StartRunBody {
  targetDurationSec: number;
  targetResolution: string;
}

export interface DetectChatGptResult {
  success: boolean;
  url?: string;
  title?: string;
  message?: string;
}

export const api = {
  // System
  health: () => request<Health>('/api/health'),
  overview: () => request<Overview>('/api/overview'),
  systemCheck: () => request<SystemCheck>('/api/system/check'),

  // Channels
  channels: () => request<{ channels: ChannelView[] }>('/api/channels'),
  channel: (id: number) => request<ChannelView>(`/api/channels/${id}`),
  createChannel: (name: string) => request<Channel>('/api/channels', { method: 'POST', json: { name } }),
  patchChannel: (id: number, patch: ChannelPatch) =>
    request<ChannelUpdate>(`/api/channels/${id}`, { method: 'PATCH', json: patch }),
  deleteChannel: (id: number) => request<{ success: true }>(`/api/channels/${id}`, { method: 'DELETE' }),
  uploadReferenceImage: (id: number, file: File) =>
    request<unknown>(`/api/channels/${id}/reference-image`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'image/jpeg' },
      body: file,
    }),
  openBrowser: (id: number) => request<unknown>(`/api/channels/${id}/open-browser`, { method: 'POST', json: {} }),
  closeBrowser: (id: number) =>
    request<{ success: boolean; message: string }>(`/api/channels/${id}/close-browser`, { method: 'POST', json: {} }),
  detectChatGptUrl: (id: number) =>
    request<DetectChatGptResult>(`/api/channels/${id}/detect-chatgpt-url`, { method: 'POST', json: {} }),

  // Runs
  startRun: (id: number, body: StartRunBody) =>
    request<RunStatus>(`/api/channels/${id}/run`, { method: 'POST', json: body }),
  cancelRun: (id: number) =>
    request<{ success: boolean; message: string }>(`/api/channels/${id}/cancel-run`, { method: 'POST', json: {} }),
  runStatus: (id: number) => request<RunStatus>(`/api/channels/${id}/run-status`),
  skipLogin: (id: number) => request<{ success: true }>(`/api/channels/${id}/skip-login`, { method: 'POST', json: {} }),
  runs: (params: { channel_id?: number; limit?: number } = {}) => request<{ runs: Run[] }>(`/api/runs${query(params)}`),

  // Accounts and logins
  accounts: (id: number) => request<AccountsOverview>(`/api/channels/${id}/accounts`),
  checkAccounts: (id: number) =>
    request<AccountsOverview>(`/api/channels/${id}/accounts/check`, { method: 'POST', json: {} }),
  cancelAccounts: (id: number) =>
    request<AccountsOverview>(`/api/channels/${id}/accounts/cancel`, { method: 'POST', json: {} }),
  switchAccount: (id: number, site: string) =>
    request<AccountsOverview>(`/api/channels/${id}/accounts/${encodeURIComponent(site)}/switch`, {
      method: 'POST',
      json: {},
    }),

  // Videos
  videos: (params: { channel_id?: number; state?: VideoState; limit?: number; offset?: number } = {}) =>
    request<{ videos: Video[]; total: number }>(`/api/videos${query(params)}`),
  approveVideo: (id: string) => request<Video>(`/api/videos/${id}/approve`, { method: 'POST', json: {} }),
  rejectVideo: (id: string) => request<Video>(`/api/videos/${id}/reject`, { method: 'POST', json: {} }),
  publishVideo: (id: string) => request<RunStatus & { started: boolean }>(`/api/videos/${id}/publish`, { method: 'POST', json: {} }),
  deleteVideo: (id: string, record: boolean) =>
    request<{ success: true }>(`/api/videos/${id}${record ? '?record=1' : ''}`, { method: 'DELETE' }),

  // Storage
  storageStatus: () => request<StorageStatus>('/api/storage/status'),
  openFolder: (target: 'videos' | 'logs' | 'storage') =>
    request<{ success: true; path: string }>('/api/storage/open-folder', { method: 'POST', json: { target } }),
  cleanup: (body: { frames?: boolean; orphanVideos?: boolean }) =>
    request<CleanupResult>('/api/storage/cleanup', { method: 'POST', json: body }),
};
