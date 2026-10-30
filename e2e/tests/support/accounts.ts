/** Accounts the specs need besides the administrator, made through an invitation link. */

export interface Person {
  name: string;
  email: string;
  password: string;
}

/**
 * Signs `person` up from a project invitation link (registration is invite-only) and returns
 * their session cookie. `adminCookie` is the cookie of someone who may invite to the project.
 */
export async function signUpViaInvite(
  base: string,
  adminCookie: string,
  projectId: string,
  role: 'reader' | 'commenter' | 'editor',
  person: Person,
): Promise<string> {
  const json = { 'content-type': 'application/json', origin: base };
  const created = await fetch(`${base}/api/v1/invitations`, {
    method: 'POST',
    headers: { ...json, cookie: adminCookie },
    body: JSON.stringify({ kind: 'link', projectId, role }),
  });
  if (!created.ok) throw new Error(`Invitation failed: ${created.status} ${await created.text()}`);
  const { invitation } = (await created.json()) as { invitation: { url: string } };
  const token = new URL(invitation.url).pathname.split('/').pop();
  const claim = await fetch(`${base}/api/v1/invitations/by-token/${token}/claim`, {
    method: 'POST',
    headers: json,
    body: '{}',
  });
  if (!claim.ok) throw new Error(`Claim failed: ${claim.status}`);
  const invited = claim.headers.getSetCookie().map((c) => c.split(';')[0]);
  const signUp = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { ...json, cookie: invited.join('; ') },
    body: JSON.stringify(person),
  });
  if (!signUp.ok) throw new Error(`Sign up failed: ${signUp.status} ${await signUp.text()}`);
  return signUp.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}
