export function isAdminRequest(headers: Headers) {
  const configured = process.env.CHAINSOCIAL_ADMIN_TOKEN?.trim();
  if (!configured) return false;
  const provided = headers.get("x-admin-token")?.trim();
  return !!provided && provided === configured;
}
