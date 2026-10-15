const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export function tenantCrmUrl(adminOrigin: string, slug: string): string {
  const origin = new URL(adminOrigin);
  if (!slugPattern.test(slug)) throw new Error("Invalid tenant slug");
  const suffix = origin.hostname.startsWith("admin.")
    ? origin.hostname.slice("admin.".length)
    : origin.hostname;
  return `${origin.protocol}//${slug}.${suffix}`;
}
