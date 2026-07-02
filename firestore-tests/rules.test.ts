// Firestore security-rules unit tests (SEC-1 / SEC-13).
//
// These run against the Firestore emulator. Requires JDK 21+ (the emulator's minimum) and the
// firebase CLI. From this directory: `npm install && npm test`.
//
// The suite pins the intended behavior of the role-aware vehicle-update rule: a plain member may
// write config, an admin/owner may write anything, any member may remove themselves, but a non-admin
// member may NOT escalate their role, seize ownership, forge tier, or grant access to other users.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore';

let env: RulesTestEnvironment;

const OWNER = { uid: 'owner1', email: 'owner@example.com' };
const ADMIN_MEMBER = { uid: 'admin2', email: 'admin2@example.com' };
const MONITOR = { uid: 'mon3', email: 'monitor@example.com' };
const OUTSIDER = { uid: 'out4', email: 'outsider@example.com' };

// A fully-formed shared vehicle: owner + an admin member + a monitor member.
const VEHICLE = {
  name: 'Boat 1',
  owner: OWNER.uid,
  allowedUsers: [OWNER.uid, ADMIN_MEMBER.uid, MONITOR.uid],
  members: {
    [OWNER.uid]: { role: 'admin', email: OWNER.email },
    [ADMIN_MEMBER.uid]: { role: 'admin', email: ADMIN_MEMBER.email },
    [MONITOR.uid]: { role: 'monitor', email: MONITOR.email },
  },
  tier: 'free',
  lt_pollInterval: 8,
};

function ctx(u: { uid: string; email: string }) {
  return env.authenticatedContext(u.uid, { email: u.email }).firestore();
}
function adminCtx() {
  return env.authenticatedContext('op9', { email: 'op@example.com', admin: true }).firestore();
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'brvg-rules-test',
    firestore: { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') },
  });
});
afterAll(async () => env && (await env.cleanup()));

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'vehicles/v1'), VEHICLE);
    await setDoc(doc(c.firestore(), 'users/' + MONITOR.uid), { trialsUsed: ['v1'], fcmToken: 'tok' });
  });
});

describe('vehicles: config writes (must keep working)', () => {
  it('a monitor member may write config fields', async () => {
    await assertSucceeds(updateDoc(doc(ctx(MONITOR), 'vehicles/v1'), { lt_pollInterval: 30 }));
  });
  it('a config write that also arrayUnion-re-adds self to allowedUsers is a no-op and allowed', async () => {
    // Mirrors updateVehicleConfig: { ...config, allowedUsers: arrayUnion(self) } for an existing member.
    await assertSucceeds(
      updateDoc(doc(ctx(MONITOR), 'vehicles/v1'), {
        lt_pollInterval: 12,
        allowedUsers: [OWNER.uid, ADMIN_MEMBER.uid, MONITOR.uid], // unchanged set
      }),
    );
  });
});

describe('vehicles: escalation (must be denied for non-admins)', () => {
  it('a monitor CANNOT promote their own role to admin', async () => {
    await assertFails(
      updateDoc(doc(ctx(MONITOR), 'vehicles/v1'), { [`members.${MONITOR.uid}.role`]: 'admin' }),
    );
  });
  it('a monitor CANNOT seize ownership', async () => {
    await assertFails(updateDoc(doc(ctx(MONITOR), 'vehicles/v1'), { owner: MONITOR.uid }));
  });
  it('a monitor CANNOT forge the tier', async () => {
    await assertFails(updateDoc(doc(ctx(MONITOR), 'vehicles/v1'), { tier: 'premium' }));
  });
  it('a monitor CANNOT clear trialEndsAt', async () => {
    await assertFails(updateDoc(doc(ctx(MONITOR), 'vehicles/v1'), { trialEndsAt: deleteField() }));
  });
  it('a monitor CANNOT add another user to allowedUsers', async () => {
    await assertFails(
      updateDoc(doc(ctx(MONITOR), 'vehicles/v1'), {
        allowedUsers: [OWNER.uid, ADMIN_MEMBER.uid, MONITOR.uid, OUTSIDER.uid],
      }),
    );
  });
});

describe('vehicles: legitimate privileged flows (must be allowed)', () => {
  it('an admin member may change another member’s role', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx(ADMIN_MEMBER), 'vehicles/v1'), { [`members.${MONITOR.uid}.role`]: 'control' }),
    );
  });
  it('the owner may transfer ownership + promote the new owner', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx(OWNER), 'vehicles/v1'), {
        owner: ADMIN_MEMBER.uid,
        [`members.${ADMIN_MEMBER.uid}.role`]: 'admin',
      }),
    );
  });
  it('an admin may set the tier (coupon / mock billing)', async () => {
    await assertSucceeds(updateDoc(doc(ctx(OWNER), 'vehicles/v1'), { tier: 'basic' }));
  });
  it('a monitor may remove ONLY themselves (leaveVehicle)', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx(MONITOR), 'vehicles/v1'), {
        allowedUsers: [OWNER.uid, ADMIN_MEMBER.uid],
        [`members.${MONITOR.uid}`]: deleteField(),
      }),
    );
  });
});

describe('vehicles: creator backfill + operator', () => {
  it('a creator may backfill members/owner on a legacy doc that has neither', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'vehicles/legacy'), {
        name: 'old', allowedUsers: [OWNER.uid], // no members, no owner
      });
    });
    await assertSucceeds(
      updateDoc(doc(ctx(OWNER), 'vehicles/legacy'), {
        owner: OWNER.uid,
        [`members.${OWNER.uid}`]: { role: 'admin', email: OWNER.email },
      }),
    );
  });
  it('an operator (admin claim) may change only the tier/membership fields', async () => {
    await assertSucceeds(updateDoc(doc(adminCtx(), 'vehicles/v1'), { tier: 'premium' }));
    await assertFails(updateDoc(doc(adminCtx(), 'vehicles/v1'), { lt_pollInterval: 99 }));
  });
});

describe('users: trialsUsed is worker-only (SEC-13)', () => {
  it('a user may write fcmToken / config on their own doc', async () => {
    await assertSucceeds(updateDoc(doc(ctx(MONITOR), 'users/' + MONITOR.uid), { fcmToken: 'new' }));
  });
  it('a user CANNOT clear or edit their own trialsUsed', async () => {
    await assertFails(
      updateDoc(doc(ctx(MONITOR), 'users/' + MONITOR.uid), { trialsUsed: [] }),
    );
  });
  it('a user CANNOT create their doc pre-seeded with trialsUsed', async () => {
    await assertFails(
      setDoc(doc(ctx(OUTSIDER), 'users/' + OUTSIDER.uid), { trialsUsed: ['v1'] }),
    );
  });
  it('a user cannot read another user’s doc', async () => {
    await assertFails(getDoc(doc(ctx(OUTSIDER), 'users/' + MONITOR.uid)));
  });
});
