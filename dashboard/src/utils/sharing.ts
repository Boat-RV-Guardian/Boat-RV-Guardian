// Per-vehicle Friends sharing (option 2: shareable, no email service).
//
// Model:
//  - A vehicle doc carries `members: { <uid>: { role, email } }` plus the existing
//    `allowedUsers: [uid]` array (kept in sync; it drives the array-contains query).
//  - An invite lives in `invites/{autoId}`:
//      { vehicleId, vehicleName, role, invitedBy, invitedByEmail, inviteeEmail (lowercased),
//        status: 'pending'|'accepted'|'declined', createdAt }
//  - Invites are NOT auto-applied. The invitee discovers pending invites by their email and
//    explicitly accepts. Accepting adds them to the vehicle's members/allowedUsers; declining
//    just marks the invite. Admins manage members and can revoke; members can leave.
//
// Security is enforced by Firestore rules (see CLAUDE.md). The claim write sets a transient
// `lastClaimInviteId` on the vehicle so the rule can verify a matching pending invite exists.
import { db, auth } from '../services/firebase';
import {
  doc, getDoc, setDoc, updateDoc, collection, addDoc, query, where, getDocs,
  arrayUnion, arrayRemove, deleteField,
} from 'firebase/firestore';

export type VehicleRole = 'admin' | 'control' | 'monitor';

export const ROLE_OPTIONS: { value: VehicleRole; label: string; desc: string }[] = [
  { value: 'admin', label: 'Full Admin', desc: 'Manage settings, devices, and sharing' },
  { value: 'control', label: 'Monitor & Control devices', desc: 'View status and operate valves/relays' },
  { value: 'monitor', label: 'Monitor devices', desc: 'View status only — no control' },
];

export const ROLE_LABELS: Record<VehicleRole, string> = {
  admin: 'Full Admin',
  control: 'Monitor & Control',
  monitor: 'Monitor only',
};

export interface Invite {
  id: string;
  vehicleId: string;
  vehicleName: string;
  role: VehicleRole;
  invitedBy: string;
  invitedByEmail: string;
  inviteeEmail: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
}

export interface Member {
  uid: string;
  role: VehicleRole;
  email: string;
}

const emailKey = (e: string) => e.trim().toLowerCase();

/** The current user's role on a vehicle, from its doc data. Legacy members (no map) = admin. */
export function getMyRole(vehicleData: any): VehicleRole | null {
  const uid = auth.currentUser?.uid;
  if (!uid || !vehicleData) return null;
  const m = vehicleData.members?.[uid];
  if (m?.role) return m.role;
  if ((vehicleData.allowedUsers || []).includes(uid)) return 'admin'; // original owner, pre-roles
  return null;
}

export function getMembers(vehicleData: any): Member[] {
  const members = vehicleData?.members || {};
  return Object.entries(members).map(([uid, m]: [string, any]) => ({
    uid, role: m?.role || 'monitor', email: m?.email || '(unknown)',
  }));
}

/** Make sure the current user is recorded as an admin member of a vehicle they own. */
export async function ensureOwnerAdmin(vid: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !vid) return;
  const ref = doc(db, 'vehicles', vid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() as any;
  if (!data.members?.[user.uid]) {
    await setDoc(ref, {
      members: { [user.uid]: { role: 'admin', email: emailKey(user.email || '') } },
      allowedUsers: arrayUnion(user.uid),
    }, { merge: true });
  }
}

/** Create a pending invite (admin only, enforced by rules). Returns the invite for display. */
export async function createInvite(
  vid: string, vehicleName: string, inviteeEmail: string, role: VehicleRole,
): Promise<Invite> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be logged in');
  const email = emailKey(inviteeEmail);
  if (!email || !email.includes('@')) throw new Error('Enter a valid email address');
  if (email === emailKey(user.email || '')) throw new Error("You can't invite yourself");

  await ensureOwnerAdmin(vid); // make sure ownership/role is recorded before sharing

  const payload = {
    vehicleId: vid,
    vehicleName,
    role,
    invitedBy: user.uid,
    invitedByEmail: user.email || '',
    inviteeEmail: email,
    status: 'pending' as const,
    createdAt: Date.now(),
  };
  const ref = await addDoc(collection(db, 'invites'), payload);
  return { id: ref.id, ...payload };
}

/** Pending + historical invites the current user sent for a vehicle. */
export async function listSentInvites(vid: string): Promise<Invite[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const q = query(collection(db, 'invites'), where('vehicleId', '==', vid), where('invitedBy', '==', uid));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Invite[];
}

/** Accept an invite: add self to the vehicle with the granted role, then mark it accepted. */
export async function acceptInvite(invite: Invite): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be logged in');
  const vRef = doc(db, 'vehicles', invite.vehicleId);

  // 1) Add self to the vehicle. lastClaimInviteId lets the security rule verify this invite.
  await setDoc(vRef, {
    members: { [user.uid]: { role: invite.role, email: emailKey(user.email || '') } },
    allowedUsers: arrayUnion(user.uid),
    lastClaimInviteId: invite.id,
  }, { merge: true });

  // 2) Mark the invite accepted (best-effort; access is already granted above).
  try {
    await updateDoc(doc(db, 'invites', invite.id), {
      status: 'accepted', acceptedBy: user.uid, acceptedAt: Date.now(),
    });
  } catch { /* non-fatal */ }
}

export async function declineInvite(inviteId: string): Promise<void> {
  await updateDoc(doc(db, 'invites', inviteId), { status: 'declined' });
}

/** Inviter cancels/removes a pending invite. */
export async function cancelInvite(inviteId: string): Promise<void> {
  await updateDoc(doc(db, 'invites', inviteId), { status: 'declined' });
}

/** Admin removes another member from a vehicle. */
export async function removeMember(vid: string, uid: string): Promise<void> {
  await updateDoc(doc(db, 'vehicles', vid), {
    [`members.${uid}`]: deleteField(),
    allowedUsers: arrayRemove(uid),
  });
}

/** Current user leaves a vehicle that was shared with them. */
export async function leaveVehicle(vid: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await updateDoc(doc(db, 'vehicles', vid), {
    [`members.${uid}`]: deleteField(),
    allowedUsers: arrayRemove(uid),
  });
}
