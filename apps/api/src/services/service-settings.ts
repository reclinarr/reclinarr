import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { SetupProbeInput } from "../setup-probe.js";

export type ServiceId = "jellyfin" | "seerr" | "dispatcharr" | "bazarr";
export type FieldKind = "url" | "text" | "secret";

export interface ServiceField {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
}

export interface ServiceDefinition {
  id: ServiceId;
  label: string;
  fields: ServiceField[];
}

export const SERVICES: ServiceDefinition[] = [
  {
    id: "jellyfin",
    label: "Jellyfin",
    fields: [{ key: "JELLYFIN_URL", label: "Address", kind: "url", required: true }],
  },
  {
    id: "seerr",
    label: "Seerr",
    fields: [
      { key: "SEERR_URL", label: "Address", kind: "url" },
      { key: "SEERR_API_KEY", label: "API key", kind: "secret" },
    ],
  },
  {
    id: "dispatcharr",
    label: "Dispatcharr",
    fields: [
      { key: "DISPATCHARR_URL", label: "Address", kind: "url" },
      { key: "DISPATCHARR_API_KEY", label: "API key", kind: "secret" },
      { key: "DISPATCHARR_USERNAME", label: "Username", kind: "text" },
      { key: "DISPATCHARR_PASSWORD", label: "Password", kind: "secret" },
    ],
  },
  {
    id: "bazarr",
    label: "Bazarr",
    fields: [
      { key: "BAZARR_URL", label: "Address", kind: "url" },
      { key: "BAZARR_API_KEY", label: "API key", kind: "secret" },
    ],
  },
];

export function serviceDefinition(id: string): ServiceDefinition | undefined {
  return SERVICES.find((service) => service.id === id);
}

/** Mirrors loadConfig: an environment variable that is set and non-empty wins over the saved file. */
export function envLockedKeys(env: NodeJS.ProcessEnv): Set<string> {
  const locked = new Set<string>();
  for (const service of SERVICES) {
    for (const field of service.fields) {
      if (env[field.key]) locked.add(field.key);
    }
  }
  return locked;
}

export interface ServiceFieldView {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** Never set for secrets. */
  value?: string;
  set: boolean;
  locked: boolean;
}

export interface ServiceView {
  id: ServiceId;
  label: string;
  configured: boolean;
  fields: ServiceFieldView[];
}

export function describeServices(config: AppConfig, env: NodeJS.ProcessEnv): ServiceView[] {
  const locked = envLockedKeys(env);
  const values = config as unknown as Record<string, string | undefined>;
  return SERVICES.map((service) => ({
    id: service.id,
    label: service.label,
    configured: Boolean(values[service.fields[0]!.key]?.trim()),
    fields: service.fields.map((field) => {
      const current = values[field.key] ?? "";
      return {
        key: field.key,
        label: field.label,
        kind: field.kind,
        required: Boolean(field.required),
        ...(field.kind === "secret" ? {} : { value: current }),
        set: current !== "",
        locked: locked.has(field.key),
      };
    }),
  }));
}

const urlValue = z.string().trim().refine(
  (value) => {
    if (value === "") return true;
    try {
      const { protocol } = new URL(value);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "Address must start with http:// or https://" },
);

export const ServiceEditSchema = z.object({
  /** Blank secrets are left alone; use `clear` to remove one. */
  values: z.record(z.string(), z.string()).default({}),
  clear: z.array(z.string()).default([]),
});

export type ServiceEdit = z.infer<typeof ServiceEditSchema>;

export class ServiceEditError extends Error {
  constructor(message: string, readonly statusCode: 400 | 409) {
    super(message);
  }
}

const withoutTrailingSlash = (url: string) => url.trim().replace(/\/+$/, "");

/**
 * Secrets are write-only to admins, so a saved or environment secret must never follow a new
 * address the admin typed: that would hand it to whatever host they name.
 * `boundElsewhere` names credentials attached to this service outside its fields (Cloudflare Access).
 */
function assertSecretsStayWithAddress(
  service: ServiceDefinition,
  edit: ServiceEdit,
  current: Record<string, string | undefined>,
  locked: Set<string>,
  boundElsewhere: string[] = [],
): void {
  const urlField = service.fields.find((field) => field.kind === "url");
  const typed = urlField ? edit.values[urlField.key] : undefined;
  if (!urlField || typed === undefined || locked.has(urlField.key)) return;
  const nextUrl = withoutTrailingSlash(typed);
  if (nextUrl === "" || nextUrl === withoutTrailingSlash(current[urlField.key] ?? "")) return;

  for (const name of boundElsewhere) {
    throw new ServiceEditError(`${name} is set for ${service.label}, so its address can only change in the server environment`, 409);
  }
  for (const field of service.fields) {
    if (field.kind !== "secret") continue;
    if (locked.has(field.key)) {
      throw new ServiceEditError(`${field.label} is set by the server environment, so the ${service.label} address cannot be changed here`, 409);
    }
    if (!current[field.key]) continue;
    const reentered = (edit.values[field.key] ?? "") !== "";
    if (!reentered && !edit.clear.includes(field.key)) {
      throw new ServiceEditError(`Re-enter the ${service.label} ${field.label} when changing its address`, 400);
    }
  }
}

/** Applies an edit to the saved setup values. Throws ServiceEditError for invalid input. */
export function applyServiceEdit(
  service: ServiceDefinition,
  edit: ServiceEdit,
  stored: Record<string, string>,
  locked: Set<string>,
  boundElsewhere: string[] = [],
): Record<string, string> {
  const fields = new Map(service.fields.map((field) => [field.key, field]));
  const next = { ...stored };

  for (const key of [...Object.keys(edit.values), ...edit.clear]) {
    const field = fields.get(key);
    if (!field) throw new ServiceEditError(`${key} does not belong to ${service.label}`, 400);
    if (locked.has(key)) {
      throw new ServiceEditError(`${field.label} is set by the server environment and cannot be changed here`, 409);
    }
  }
  for (const key of edit.clear) {
    if (fields.get(key)!.kind !== "secret") {
      throw new ServiceEditError(`${key} is not a secret; send an empty value instead`, 400);
    }
    delete next[key];
  }
  assertSecretsStayWithAddress(service, edit, stored, locked, boundElsewhere);
  for (const [key, raw] of Object.entries(edit.values)) {
    const field = fields.get(key)!;
    if (field.kind === "secret") {
      if (raw !== "") next[key] = raw;
      continue;
    }
    const value = field.kind === "url" ? urlValue.safeParse(raw) : { success: true as const, data: raw.trim() };
    if (!value.success) throw new ServiceEditError(value.error.issues[0]!.message, 400);
    if (value.data === "") {
      if (field.required) throw new ServiceEditError(`${field.label} is required for ${service.label}`, 400);
      delete next[key];
    } else {
      next[key] = value.data.replace(/\/+$/, "");
    }
  }
  return next;
}

/** Form values layered over what is already saved, so blank secrets test with the stored ones (same address only). */
export function probeInputFor(
  service: ServiceDefinition,
  edit: ServiceEdit,
  config: AppConfig,
  locked: Set<string>,
): SetupProbeInput {
  const current = config as unknown as Record<string, string | undefined>;
  // The probe sends no Cloudflare Access headers, so only the service's own secrets are at stake.
  assertSecretsStayWithAddress(service, edit, current, locked);
  const input: Record<string, string> = {};
  for (const field of service.fields) {
    const typed = edit.values[field.key];
    if (locked.has(field.key)) input[field.key] = current[field.key] ?? "";
    else if (edit.clear.includes(field.key)) input[field.key] = "";
    else if (typed !== undefined && (field.kind !== "secret" || typed !== "")) input[field.key] = typed;
    else input[field.key] = current[field.key] ?? "";
  }
  return { service: service.id, ...input };
}
