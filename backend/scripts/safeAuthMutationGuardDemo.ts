#!/usr/bin/env npx tsx
/**
 * Safe Auth mutation helper for ops scripts.
 *
 * Example (WILL FAIL without break-glass when targeting pinned owner):
 *   npx tsx scripts/safeAuthMutationGuardDemo.ts delete --uid <uid>
 *
 * Never run against production without reading docs/OWNER_AUTH_PROTECTION.md.
 */

import {
  assertPinnedOwnerMutationAllowed,
  type DangerousAuthMutation
} from "../src/services/auth/pinnedOwnerMutationGuard";

function usage(): never {
  console.error(
    "Usage: safeAuthMutationGuardDemo.ts <delete|disable|email-rename|anonymise|bulk-cleanup> [--uid UID] [--email EMAIL]"
  );
  process.exit(2);
}

function main(): void {
  const [mutationRaw, ...rest] = process.argv.slice(2);
  if (!mutationRaw) usage();

  const map: Record<string, DangerousAuthMutation> = {
    delete: "DELETE",
    disable: "DISABLE",
    "email-rename": "EMAIL_RENAME",
    anonymise: "ANONYMISE",
    "bulk-cleanup": "BULK_CLEANUP"
  };
  const mutation = map[mutationRaw];
  if (!mutation) usage();

  let uid: string | undefined;
  let email: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--uid") uid = rest[i + 1];
    if (rest[i] === "--email") email = rest[i + 1];
  }

  assertPinnedOwnerMutationAllowed({ mutation, targetUid: uid, targetEmail: email });
  console.log(
    JSON.stringify({
      ok: true,
      mutation,
      note: "Guard passed — caller must still implement the mutation carefully."
    })
  );
}

try {
  main();
} catch (error) {
  const err = error as { code?: string; message?: string; mutation?: string };
  console.error(
    JSON.stringify({
      ok: false,
      code: err.code ?? "ERROR",
      mutation: err.mutation,
      message: err.message
    })
  );
  process.exit(1);
}
