import { timingSafeEqual } from "node:crypto";
import { hashToken } from "./tokens.ts";

export type OidcClient = {
  id: string;
  name: string;
  secretHash: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
};

const SECRET_HASH = /^[0-9a-f]{64}$/;

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function parseClients(json: string | undefined): OidcClient[] {
  if (!json || !json.trim()) return [];
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("OIDC_CLIENTS must be a JSON array");
  const seen = new Set<string>();
  return parsed.map((item, index) => {
    const where = `OIDC_CLIENTS[${index}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`${where} must be an object`);
    }
    const { id, name, secretHash, redirectUris, postLogoutRedirectUris = [] } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id) throw new Error(`${where}.id is required`);
    if (typeof name !== "string" || !name) throw new Error(`${where}.name is required`);
    if (typeof secretHash !== "string" || !SECRET_HASH.test(secretHash)) {
      throw new Error(`${where}.secretHash must be 64 lowercase hex characters`);
    }
    if (
      !Array.isArray(redirectUris) ||
      !redirectUris.every((uri) => typeof uri === "string" && isHttpUrl(uri))
    ) {
      throw new Error(`${where}.redirectUris must be an array of http(s) URLs`);
    }
    if (
      !Array.isArray(postLogoutRedirectUris) ||
      !postLogoutRedirectUris.every((uri) => typeof uri === "string" && isHttpUrl(uri))
    ) {
      throw new Error(`${where}.postLogoutRedirectUris must be an array of http(s) URLs`);
    }
    if (seen.has(id)) throw new Error(`Duplicate client id: ${id}`);
    seen.add(id);
    return {
      id,
      name,
      secretHash,
      redirectUris: [...redirectUris] as string[],
      postLogoutRedirectUris: [...postLogoutRedirectUris] as string[],
    };
  });
}

export function findClient(clients: OidcClient[], id: string | null): OidcClient | undefined {
  if (!id) return undefined;
  return clients.find((client) => client.id === id);
}

export function authenticateClient(
  clients: OidcClient[],
  id: string | null,
  secret: string | null,
): OidcClient | undefined {
  if (!secret) return undefined;
  const client = findClient(clients, id);
  if (!client) return undefined;
  const actual = Buffer.from(hashToken(secret), "utf8");
  const expected = Buffer.from(client.secretHash, "utf8");
  if (actual.length !== expected.length) return undefined;
  return timingSafeEqual(actual, expected) ? client : undefined;
}

export function isRegisteredRedirect(client: OidcClient, uri: string | null): boolean {
  return !!uri && client.redirectUris.includes(uri);
}

function formDecode(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return null;
  }
}

/**
 * Reads `Authorization: Basic …` (client_secret_basic). The id and secret are
 * form-urlencoded before base64 (RFC 6749 §2.3.1), so both are decoded again here.
 * Returns null when the header is not a well-formed Basic credential.
 */
export function parseBasicCredentials(header: string): { id: string; secret: string } | null {
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header.trim());
  if (!match) return null;
  const raw = Buffer.from(match[1], "base64").toString("utf8");
  const colon = raw.indexOf(":");
  if (colon < 0) return null;
  const id = formDecode(raw.slice(0, colon));
  const secret = formDecode(raw.slice(colon + 1));
  if (!id || !secret) return null;
  return { id, secret };
}
