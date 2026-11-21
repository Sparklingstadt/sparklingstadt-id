export function clientIp(headers: Pick<Headers, "get">): string {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
}
