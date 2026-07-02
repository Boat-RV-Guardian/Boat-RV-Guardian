# Firestore rules tests

Emulator-backed unit tests for [`../firestore.rules`](../firestore.rules). They pin the role-aware
vehicle-update rule and the `users/{uid}.trialsUsed` protection (SEC-1 / SEC-13 from the 2026-07-02
security review).

## Run

```bash
cd firestore-tests
npm install
npm test        # boots the Firestore emulator, runs vitest, tears it down
```

**Requires JDK 21+** — the Firebase Firestore emulator will not start on older Java. Check with
`java -version`; install a newer JDK (e.g. `brew install openjdk@21`) if needed.

## What it covers

- Config writes by a plain member still work (incl. the `allowedUsers: arrayUnion(self)` no-op that
  every `updateVehicleConfig` write carries).
- A non-admin member **cannot** escalate their role, seize `owner`, forge `tier`, clear `trialEndsAt`,
  or add another user to `allowedUsers`.
- Admin/owner flows still work: change a member's role, transfer ownership, set tier via coupon,
  self-leave, creator backfill, and the operator (`admin` claim) tier-only update.
- `users/{uid}.trialsUsed` is worker-only: a user can write `fcmToken`/config but cannot clear or
  seed `trialsUsed`.

## ⚠️ Not yet executed in CI

Authored during the security review but **not run here** (the review box had only JDK 18). Run the
suite locally and confirm green **before deploying** the rules.
