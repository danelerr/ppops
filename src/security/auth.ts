import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

export const bearerTokenMatches = (
  authorizationHeader: string | undefined,
  expectedToken: string,
): boolean => {
  if (!authorizationHeader?.startsWith("Bearer ")) return false;
  const supplied = authorizationHeader.slice("Bearer ".length);
  return timingSafeEqual(digest(supplied), digest(expectedToken));
};
