import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Stored as `scrypt$N$r$p$salt$hash` (base64url) so parameters can change later.
const ALGORITHM = "scrypt";
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function deriveKey(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelization: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { N: cost, r: blockSize, p: parallelization },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, COST, BLOCK_SIZE, PARALLELIZATION);

  return [
    ALGORITHM,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, salt, key] =
    storedHash.split("$");
  if (algorithm !== ALGORITHM || !salt || !key) return false;

  const expected = Buffer.from(key, "base64url");
  if (expected.length !== KEY_LENGTH) return false;

  const actual = await deriveKey(
    password,
    Buffer.from(salt, "base64url"),
    Number(cost),
    Number(blockSize),
    Number(parallelization),
  );

  return timingSafeEqual(actual, expected);
}
