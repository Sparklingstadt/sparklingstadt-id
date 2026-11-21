export type ValidationField = "email" | "displayName" | "password" | "token";

export class ValidationError extends Error {
  field: ValidationField;
  code: string;

  constructor(field: ValidationField, code: string) {
    super(`${field}: ${code}`);
    this.name = "ValidationError";
    this.field = field;
    this.code = code;
  }
}

// One mailbox and nothing else: the address is mailed as typed and handed to clients as verified, so
// list separators, display-name syntax and quoting are refused.
const EMAIL_LOCAL_PART = /^[^\s@,;:<>()[\]\\"\p{Cc}]+$/u;
const EMAIL_DOMAIN_LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u;

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  const labels = email.slice(at + 1).split(".");
  if (
    email.length > 254 ||
    at <= 0 ||
    !EMAIL_LOCAL_PART.test(email.slice(0, at)) ||
    labels.length < 2 ||
    !labels.every((label) => EMAIL_DOMAIN_LABEL.test(label))
  ) {
    throw new ValidationError("email", "emailInvalid");
  }
  return email;
}

export function normalizeDisplayName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 50 || name.includes("\0")) {
    throw new ValidationError("displayName", "displayNameInvalid");
  }
  return name;
}

export function checkPassword(value: string): string {
  if (value.length < 12 || value.length > 128) {
    throw new ValidationError("password", "passwordLength");
  }
  return value;
}

export function safeNextPath(value: string | null | undefined, fallback: string): string {
  if (!value || value.length > 2048 || value[0] !== "/" || value[1] === "/" || value[1] === "\\") {
    return fallback;
  }
  try {
    if (new URL(value, "http://x").origin !== "http://x") return fallback;
  } catch {
    return fallback;
  }
  return value;
}
