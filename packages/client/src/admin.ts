export type ServiceId = "jellyfin" | "seerr" | "dispatcharr" | "bazarr";

export interface ServiceFieldView {
  key: string;
  label: string;
  kind: "url" | "text" | "secret";
  required: boolean;
  /** Absent for secrets. */
  value?: string;
  set: boolean;
  /** Set by the server environment, so it cannot be changed here. */
  locked: boolean;
}

export interface ServiceView {
  id: ServiceId;
  label: string;
  configured: boolean;
  fields: ServiceFieldView[];
}

export type AdminServicesResponse = { admin: false } | { admin: true; services: ServiceView[] };

export interface ServiceEdit {
  /** A blank secret keeps the saved one. */
  values: Record<string, string>;
  /** Secrets to remove. */
  clear: string[];
}

export interface ServiceTestResult {
  ok: boolean;
  message: string;
}
