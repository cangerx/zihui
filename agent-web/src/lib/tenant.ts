import { featureFlags } from "@/lib/features";

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

export function getTenantBaseDomain(): string {
  return (process.env.NEXT_PUBLIC_TENANT_BASE_DOMAIN || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "");
}

export function detectTenantParams(): { agent_code?: string; domain?: string } {
  if (!featureFlags.agency || typeof window === "undefined") return {};

  const host = window.location.hostname.toLowerCase();
  if (localHosts.has(host)) return {};

  const baseDomain = getTenantBaseDomain();
  if (baseDomain) {
    if (host === baseDomain || host === `www.${baseDomain}` || host === `app.${baseDomain}`) {
      return {};
    }
    const suffix = `.${baseDomain}`;
    if (host.endsWith(suffix)) {
      const code = host.slice(0, -suffix.length);
      if (/^[a-z0-9-]+$/.test(code)) return { agent_code: code };
    }
  }

  return { domain: host };
}

export function getTenantCode(): string | null {
  if (!featureFlags.agency || typeof window === "undefined") return null;
  return detectTenantParams().agent_code || localStorage.getItem("agent_code") || null;
}
