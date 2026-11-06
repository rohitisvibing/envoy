import type {
  AgentTemplate,
  AppErrorPayload,
  Conversation,
  ConversationDetail,
  ConversationMode,
  Health,
  Mission,
  MissionSpec,
  MissionSummary,
  OutcomeReport,
  PrincipalProfile,
} from "@/types/api";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export function wsUrl(path: string): string {
  return API_URL.replace(/^http/, "ws") + path;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public payload: AppErrorPayload,
  ) {
    super(payload.message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, {
      kind: "network",
      message: `Can't reach the backend at ${API_URL}. Start it with: cd backend && uv run uvicorn app.main:app --reload`,
    });
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const payload: AppErrorPayload =
      body?.error ??
      (Array.isArray(body?.detail)
        ? { kind: "validation", message: body.detail.map((d: { msg: string }) => d.msg).join("; ") }
        : { kind: "http", message: body?.detail ?? `Request failed (${res.status})` });
    throw new ApiError(res.status, payload);
  }
  return body as T;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  health: () => request<Health>("/api/health"),
  profile: () => request<PrincipalProfile>("/api/profile"),
  saveProfile: (p: Partial<PrincipalProfile>) =>
    request<PrincipalProfile>("/api/profile", { method: "PUT", body: json(p) }),
  templates: () => request<AgentTemplate[]>("/api/templates"),
  missions: () => request<MissionSummary[]>("/api/missions"),
  mission: (id: string) => request<Mission>(`/api/missions/${id}`),
  extract: (body: { text: string; counterparty_type?: string; languages?: string[]; tone?: string; template_id?: string }) =>
    request<Mission>("/api/missions/extract", { method: "POST", body: json(body) }),
  refine: (id: string, answers: Record<string, string>) =>
    request<Mission>(`/api/missions/${id}/refine`, { method: "POST", body: json({ answers }) }),
  updateSpec: (id: string, spec: MissionSpec) =>
    request<Mission>(`/api/missions/${id}/spec`, { method: "PUT", body: json(spec) }),
  approve: (id: string) => request<Mission>(`/api/missions/${id}/approve`, { method: "POST" }),
  prepare: (id: string) => request<Mission>(`/api/missions/${id}/prepare`, { method: "POST" }),
  deleteMission: (id: string) => request<void>(`/api/missions/${id}`, { method: "DELETE" }),
  createConversation: (mission_id: string, mode: ConversationMode, voice_enabled = true) =>
    request<Conversation>("/api/conversations", {
      method: "POST",
      body: json({ mission_id, mode, voice_enabled }),
    }),
  conversation: (id: string) => request<ConversationDetail>(`/api/conversations/${id}`),
  report: (id: string) => request<OutcomeReport>(`/api/conversations/${id}/report`),
};
