import { randomUUID } from "node:crypto";

/**
 * A client as OIDC_CLIENTS lists it (the format from before Better Auth). `secretHash` is the SHA-256 hex of the
 * secret, which is also what the oauth-provider plugin stores (lib/auth.ts storeClientSecret), so a client keeps its
 * secret across the move.
 */
export type ClientEntry = {
  id: string;
  name: string;
  secretHash: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
};

/** The oauthClient values importClients writes. */
export type ClientRow = {
  clientId: string;
  name: string;
  clientSecret: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  scopes: string[];
  skipConsent: boolean;
  enableEndSession: boolean;
  tokenEndpointAuthMethod: string;
  grantTypes: string[];
  responseTypes: string[];
  requirePKCE: boolean;
  disabled: boolean;
  applicationType: string;
  updatedAt: Date;
};

/** The part of the Prisma client this module uses (a memory stand-in in the unit tests). */
export type ClientStore = {
  oauthClient: {
    findUnique(args: {
      where: { clientId: string };
      select?: { id: true; postLogoutRedirectUris: true };
    }): Promise<{ id: string; postLogoutRedirectUris: string[] } | null>;
    create(args: { data: ClientRow & { id: string; createdAt: Date } }): Promise<unknown>;
    update(args: { where: { clientId: string }; data: ClientRow }): Promise<unknown>;
  };
};

const SECRET_HASH = /^[0-9a-f]{64}$/;

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Reads OIDC_CLIENTS. Errors name the entry and the field, never a value: the list holds the secret hashes.
 */
export function parseClientEntries(json: string | undefined): ClientEntry[] {
  if (!json || !json.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("OIDC_CLIENTS is not valid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("OIDC_CLIENTS must be a JSON array");
  const seen = new Set<string>();
  return parsed.map((item, index) => {
    const where = `OIDC_CLIENTS[${index}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error(`${where} must be an object`);
    const { id, name, secretHash, redirectUris, postLogoutRedirectUris = [] } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id) throw new Error(`${where}.id is required`);
    if (typeof name !== "string" || !name) throw new Error(`${where}.name is required`);
    if (typeof secretHash !== "string" || !SECRET_HASH.test(secretHash)) {
      throw new Error(`${where}.secretHash must be 64 lowercase hex characters`);
    }
    if (!Array.isArray(redirectUris) || !redirectUris.every(isHttpUrl)) {
      throw new Error(`${where}.redirectUris must be an array of http(s) URLs`);
    }
    if (!Array.isArray(postLogoutRedirectUris) || !postLogoutRedirectUris.every(isHttpUrl)) {
      throw new Error(`${where}.postLogoutRedirectUris must be an array of http(s) URLs`);
    }
    if (seen.has(id)) throw new Error(`${where}.id repeats an earlier client`);
    seen.add(id);
    return { id, name, secretHash, redirectUris: [...redirectUris], postLogoutRedirectUris: [...postLogoutRedirectUris] };
  });
}

function rowOf(client: ClientEntry, now: Date): ClientRow {
  return {
    clientId: client.id,
    name: client.name,
    clientSecret: client.secretHash,
    redirectUris: client.redirectUris,
    postLogoutRedirectUris: client.postLogoutRedirectUris,
    // Every client gets the same claims and signs in without a consent screen, as before.
    scopes: ["openid", "email", "profile"],
    skipConsent: true,
    enableEndSession: true,
    // The registered method only names the default: lib/id/oidc-compat.ts lets client_secret_post through as well.
    tokenEndpointAuthMethod: "client_secret_basic",
    grantTypes: ["authorization_code"],
    responseTypes: ["code"],
    requirePKCE: true,
    disabled: false,
    // A web client's redirect_uri must match a registered one exactly, as before.
    applicationType: "web",
    updatedAt: now,
  };
}

/**
 * Copies OIDC_CLIENTS into the oauthClient table: a new id is created, a known one is overwritten with the listed
 * values. Running it again with the same list changes nothing but `updatedAt`. Clients missing from the list are left
 * alone. The whole list is checked before anything is written.
 */
export async function importClients(
  prisma: ClientStore,
  clientsJson: string,
): Promise<{ created: number; updated: number }> {
  const entries = parseClientEntries(clientsJson);
  let created = 0;
  let updated = 0;
  for (const entry of entries) {
    const now = new Date();
    const data = rowOf(entry, now);
    const existing = await prisma.oauthClient.findUnique({
      where: { clientId: entry.id },
      select: { id: true, postLogoutRedirectUris: true },
    });
    if (existing) {
      await prisma.oauthClient.update({ where: { clientId: entry.id }, data });
      updated += 1;
    } else {
      await prisma.oauthClient.create({ data: { ...data, id: randomUUID(), createdAt: now } });
      created += 1;
    }
  }
  return { created, updated };
}

/** The post-logout addresses registered for a client, or null when there is no such client. */
export async function findClientPostLogoutUris(clientId: string, prisma?: ClientStore): Promise<string[] | null> {
  // Loaded on use, so that the unit tests and scripts that pass their own client need no database module.
  const store = prisma ?? (await import("@/lib/prisma")).getPrisma();
  const client = await store.oauthClient.findUnique({
    where: { clientId },
    select: { id: true, postLogoutRedirectUris: true },
  });
  return client ? client.postLogoutRedirectUris : null;
}
