import { hashPassword, needsRehash, verifyPassword } from "../password.ts";

type Deps = {
  verify: (password: string, hash: string) => Promise<boolean>;
  needsRehash: (hash: string) => boolean;
  hash: (password: string) => Promise<string>;
  /** Stores the new hash in place of `old` (unless it changed meanwhile). */
  replace: (old: string, next: string) => Promise<void>;
};

let dummyHash: Promise<string> | undefined;

/**
 * Better Auth's `password.verify`. A hash made with earlier, cheaper parameters answers sooner than the hash
 * Better Auth checks for an unknown address: after a wrong password, spend the difference, so that a registered
 * address does not stand out by its response time. After a right one, store the hash with the current parameters.
 */
export async function verifyCredential(
  hash: string,
  password: string,
  deps: Deps,
  dummy: () => Promise<string> = () => (dummyHash ??= deps.hash("unknown-id-user")),
): Promise<boolean> {
  const valid = await deps.verify(password, hash);
  if (!deps.needsRehash(hash)) return valid;
  if (!valid) {
    await deps.verify(password, await dummy());
    return false;
  }
  await deps.replace(hash, await deps.hash(password));
  return true;
}

export const credentialDeps = (replace: Deps["replace"]): Deps => ({
  verify: verifyPassword,
  needsRehash,
  hash: hashPassword,
  replace,
});
