import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * The values a script that writes to a database needs, taken only from where the person running it put them: the
 * shell, or all of them from one file named on the command line (`--env-file=production.env`). It never reads
 * .env.local, so a development value cannot reach production. Each source is printed to stderr (never the value), so
 * the person running it can check them before anything changes. Exits with a message when an argument is unknown or a
 * value is missing.
 *
 * Values come back as they are: the server takes BETTER_AUTH_SECRET byte for byte, for example. Trimming is only for
 * the check that a value is set.
 */
export function explicitEnv<const Name extends string>(
  required: readonly Name[],
  argv: readonly string[] = process.argv.slice(2),
): Record<Name, string> {
  const fileArg = argv.find((arg) => arg.startsWith("--env-file="));
  const unknownArgs = argv.filter((arg) => arg !== fileArg);
  if (unknownArgs.length > 0) {
    console.error(`Unknown argument: ${unknownArgs[0]}. The only option is --env-file=<path>.`);
    process.exit(1);
  }
  const path = fileArg?.slice("--env-file=".length);
  const file = path ? parseEnv(readFileSync(path, "utf8")) : undefined;
  const source = path ? `file ${path}` : "shell";
  const values = Object.fromEntries(
    required.map((name) => [name, (file ? file[name] : process.env[name]) ?? ""]),
  ) as Record<Name, string>;
  const missing = required.filter((name) => !values[name].trim());
  if (missing.length > 0) {
    console.error(
      `Set ${missing.join(", ")} explicitly in the shell, or in a file given as --env-file=<path>. ` +
        ".env.local is not read: this script writes to the database it is pointed at.",
    );
    process.exit(1);
  }
  for (const name of required) console.error(`${name}: from ${source}`);
  return values;
}

/** Prints which database a script is about to write to (host and name, never the credentials). */
export function printTarget(databaseUrl: string, note: string): void {
  const target = new URL(databaseUrl);
  console.error(`database: ${target.host}${target.pathname} (${note})`);
}
