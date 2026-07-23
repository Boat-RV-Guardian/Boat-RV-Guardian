import { useState } from 'react';
import { classifyForDeletion, executeAccountDeletion, type VehicleAccess, type DeletionClassification } from '../utils/accountDeletion';

// Reusable, confirm-protected account deletion (GDPR / store requirement). Used by the Account portal
// and the Settings → Danger Zone. Decision + orchestration are the pure/tested utils/accountDeletion;
// Firebase ops are lazy-imported so callers stay Firebase-light.
//
// For vehicles the user OWNS that are shared with others, we don't silently delete or orphan them —
// we ask: transfer ownership to a member, or delete the vehicle. Solo-owned vehicles are deleted;
// vehicles shared with the user (not owned) are left. Irreversible, so it requires typing DELETE.

interface OwnedSharedUI { id: string; name: string; others: { uid: string; email: string }[] }

export default function DeleteAccountButton({ uid, intro }: { uid?: string | null; intro?: string }) {
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [ownedShared, setOwnedShared] = useState<OwnedSharedUI[]>([]);
  const [decisions, setDecisions] = useState<Record<string, string>>({}); // vid -> 'delete' | targetUid
  const [classification, setClassification] = useState<DeletionClassification | null>(null);
  const [tooManyVehiclesError, setTooManyVehiclesError] = useState(false);
  const [singleVehicleName, setSingleVehicleName] = useState('');
  const [vehicleDeleteConfirmChecked, setVehicleDeleteConfirmChecked] = useState(false);

  if (!uid) return null;

  const openDelete = async () => {
    setShowDelete(true);
    setDeleteMsg(null);
    setDeleteConfirm('');
    setVehicleDeleteConfirmChecked(false);
    setTooManyVehiclesError(false);
    // Best-effort fetch of the user's vehicles to surface ownership decisions. On failure we still
    // allow a basic delete (no transfer options).
    try {
      const { db } = await import('../services/firebase');
      const fs = await import('firebase/firestore');
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'vehicles'), fs.where('allowedUsers', 'array-contains', uid)));
      const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() as any }));
      const vehicles: VehicleAccess[] = docs.map((d) => ({ id: d.id, allowedUsers: d.data.allowedUsers || [], owner: d.data.owner ?? null }));
      const cls = classifyForDeletion(vehicles, uid);
      const ui: OwnedSharedUI[] = cls.ownedShared.map((os) => {
        const d = docs.find((x) => x.id === os.id)!.data;
        const members = d.members || {};
        return { id: os.id, name: d.lt_vessel_name || os.id, others: os.others.map((o) => ({ uid: o, email: members[o]?.email || o })) };
      });
      setClassification(cls);
      setOwnedShared(ui);

      const ownedCount = cls.toDelete.length + ui.length;
      if (ownedCount > 1) {
        setTooManyVehiclesError(true);
      } else {
        if (ownedCount === 1) {
          if (cls.toDelete.length === 1) {
            const d = docs.find((x) => x.id === cls.toDelete[0])!.data;
            setSingleVehicleName(d.lt_vessel_name || cls.toDelete[0]);
          } else {
            setSingleVehicleName(ui[0].name);
            setDecisions({ [ui[0].id]: 'delete' }); // Force delete for the single shared vehicle
          }
        }
      }
    } catch { /* offline / no access — fall back to a basic delete */ }
  };

  const onDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE' || !uid) return;
    setDeleteBusy(true);
    setDeleteMsg(null);
    try {
      const { db, auth } = await import('../services/firebase');
      const fs = await import('firebase/firestore');
      const { deleteUser, signOut } = await import('firebase/auth');
      const { transferOwnership } = await import('../utils/sharing');

      // Resolve the plan: prefer the classification captured on open; otherwise fetch fresh.
      let cls = classification;
      if (!cls) {
        const snap = await fs.getDocs(fs.query(fs.collection(db, 'vehicles'), fs.where('allowedUsers', 'array-contains', uid)));
        const vehicles: VehicleAccess[] = snap.docs.map((d) => ({ id: d.id, allowedUsers: (d.data() as any).allowedUsers || [], owner: (d.data() as any).owner ?? null }));
        cls = classifyForDeletion(vehicles, uid);
      }

      const errors: string[] = [];
      const extraDelete: string[] = [];
      const extraLeave: string[] = [];
      // Apply the per-vehicle owner decisions.
      for (const v of ownedShared) {
        const choice = decisions[v.id];
        if (!choice || choice === 'delete') { extraDelete.push(v.id); continue; }
        const target = v.others.find((o) => o.uid === choice);
        try { await transferOwnership(v.id, choice, target?.email || ''); extraLeave.push(v.id); }
        catch (e: any) { errors.push(`transfer ${v.name}: ${e?.message || e}`); }
      }
      // If we had no classification (offline), ownedShared is empty and these spreads are no-ops.
      const plan = { toDelete: [...cls.toDelete, ...extraDelete], toLeave: [...cls.toLeave, ...extraLeave] };

      const res = await executeAccountDeletion(plan, uid, {
        deleteVehicle: (vid) => fs.deleteDoc(fs.doc(db, 'vehicles', vid)),
        leaveVehicle: (vid, u) => fs.updateDoc(fs.doc(db, 'vehicles', vid), { allowedUsers: fs.arrayRemove(u) }),
        deleteUserDoc: (u) => fs.deleteDoc(fs.doc(db, 'users', u)),
        deleteAuthUser: () => (auth.currentUser ? deleteUser(auth.currentUser) : Promise.resolve()),
        signOut: () => signOut(auth),
        clearLocal: () => { try { localStorage.clear(); } catch { /* ignore */ } },
      }, errors); // fold ownership-transfer failures in so they also block the irreversible Auth delete
      if (res.errors.length) {
        // Data cleanup failed → the Auth account was deliberately NOT deleted (you're still signed in),
        // so nothing is orphaned. Surface the cause and let the user retry.
        const msg = res.authDeleted
          ? `Your data was deleted, but finishing account removal needs a recent sign-in. Please sign in again and retry. (${res.errors[0]})`
          : `Couldn't fully delete your data, so your account was NOT removed — you're still signed in. Please retry. (${res.errors[0]})`;
        setDeleteMsg(msg);
        setDeleteBusy(false);
      } else {
        window.location.reload();
      }
    } catch (e: any) {
      setDeleteMsg(`Deletion failed: ${e?.message || e}`);
      setDeleteBusy(false);
    }
  };

  if (!showDelete) {
    return (
      <button onClick={openDelete} style={{ background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '0.85rem' }}>
        Delete account
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <span style={{ fontSize: '0.82rem', color: '#fca5a5' }}>
        {intro || 'This permanently deletes your account and the vehicles you solely own, and removes you from shared ones.'}{' '}
        This <strong>cannot be undone.</strong>
      </span>

      {tooManyVehiclesError ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '10px' }}>
          <span style={{ fontSize: '0.85rem', color: '#fca5a5' }}>
            You own multiple vehicles. Please transfer or delete all but one vehicle in Settings &rarr; Vehicle before deleting your account.
          </span>
          <button onClick={() => setShowDelete(false)} className="btn-secondary" style={{ padding: '8px 14px', fontSize: '0.85rem', alignSelf: 'flex-start' }}>Close</button>
        </div>
      ) : (
        <>
          {singleVehicleName && (
            <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.82rem', color: '#fff', cursor: 'pointer', padding: '8px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.2)' }}>
              <input type="checkbox" checked={vehicleDeleteConfirmChecked} onChange={(e) => setVehicleDeleteConfirmChecked(e.target.checked)} />
              I understand that my vehicle <strong>{singleVehicleName}</strong> will also be permanently deleted.
            </label>
          )}

      <span style={{ fontSize: '0.82rem', color: '#fca5a5' }}>Type <strong>DELETE</strong> to confirm.</span>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
          placeholder="DELETE"
          aria-label="Type DELETE to confirm"
          style={{ flex: '1 1 120px', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(0,0,0,0.25)', color: '#fff' }}
        />
        <button
          onClick={onDeleteAccount}
          disabled={deleteConfirm !== 'DELETE' || (!!singleVehicleName && !vehicleDeleteConfirmChecked) || deleteBusy}
          style={{
            background: deleteConfirm === 'DELETE' && (!singleVehicleName || vehicleDeleteConfirmChecked) && !deleteBusy ? '#ef4444' : '#7f1d1d',
            border: 'none', color: '#fff', borderRadius: '8px', padding: '8px 16px',
            cursor: deleteConfirm === 'DELETE' && (!singleVehicleName || vehicleDeleteConfirmChecked) && !deleteBusy ? 'pointer' : 'not-allowed',
            fontSize: '0.85rem'
          }}
        >
          {deleteBusy ? 'Deleting…' : 'Permanently delete'}
        </button>
        <button onClick={() => { setShowDelete(false); setDeleteConfirm(''); }} className="btn-secondary" style={{ padding: '8px 14px', fontSize: '0.85rem' }}>Cancel</button>
      </div>
      {deleteMsg && <span style={{ fontSize: '0.8rem', color: '#fca5a5' }}>{deleteMsg}</span>}
    </>
  )}
</div>
  );
}
