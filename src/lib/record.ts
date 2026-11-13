/** JSON object view. A non-object becomes {}. Callers still check the fields they use. */
export function asRec(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}
