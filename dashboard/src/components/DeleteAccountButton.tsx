import { useState } from 'react';
import { accountDeletionPlan, executeAccountDeletion, type VehicleAccess } from '../utils/accountDeletion';

// Reusable, confirm-protected account deletion (GDPR / store requirement). Used by the Account portal
// and the Settings → Danger Zone. The decision + orchestration are the pure/tested
// utils/accountDeletion; the Firebase ops are lazy-imported here so callers stay Firebase-light.
//
// Renders nothing unless `uid` is provided (callers gate on the signed-in user). The actual delete
// uses auth.currentUser. Irreversible, so it requires typing DELETE.
export default function DeleteAccountButton({ uid, intro }: { uid?: string | null; intro?: string }) {
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  if (!uid) return null;

  const onDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE' || !uid) return;
    setDeleteBusy(true);
    setDeleteMsg(null);
    try {
      const { db, auth } = await import('../services/firebase');
      const fs = await import('firebase/firestore');
      const { deleteUser, signOut } = await import('firebase/auth');
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'vehicles'), fs.where('allowedUsers', 'array-contains', uid)));
      const vehicles: VehicleAccess[] = snap.docs.map((d) => ({ id: d.id, allowedUsers: (d.data() as any).allowedUsers || [] }));
      const plan = accountDeletionPlan(vehicles, uid);
      const res = await executeAccountDeletion(plan, uid, {
        deleteVehicle: (vid) => fs.deleteDoc(fs.doc(db, 'vehicles', vid)),
        leaveVehicle: (vid, u) => fs.updateDoc(fs.doc(db, 'vehicles', vid), { allowedUsers: fs.arrayRemove(u) }),
        deleteUserDoc: (u) => fs.deleteDoc(fs.doc(db, 'users', u)),
        deleteAuthUser: () => (auth.currentUser ? deleteUser(auth.currentUser) : Promise.resolve()),
        signOut: () => signOut(auth),
        clearLocal: () => { try { localStorage.clear(); } catch { /* ignore */ } },
      });
      if (res.errors.length) {
        setDeleteMsg(`Deleted ${res.deletedVehicles} vehicle(s); ${res.errors.length} step(s) need attention: ${res.errors[0]}. You may need to sign in again and retry.`);
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
      <button onClick={() => { setShowDelete(true); setDeleteMsg(null); }} style={{ background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontSize: '0.85rem' }}>
        Delete account
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <span style={{ fontSize: '0.82rem', color: '#fca5a5' }}>
        {intro || 'This permanently deletes your account and the vehicles you solely own, and removes you from shared ones.'}{' '}
        This <strong>cannot be undone.</strong> Type <strong>DELETE</strong> to confirm.
      </span>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
          placeholder="DELETE"
          aria-label="Type DELETE to confirm"
          style={{ flex: '1 1 120px', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.5)', background: 'rgba(0,0,0,0.25)', color: '#fff' }}
        />
        <button onClick={onDeleteAccount} disabled={deleteConfirm !== 'DELETE' || deleteBusy} style={{ background: deleteConfirm === 'DELETE' && !deleteBusy ? '#ef4444' : '#7f1d1d', border: 'none', color: '#fff', borderRadius: '8px', padding: '8px 16px', cursor: deleteConfirm === 'DELETE' && !deleteBusy ? 'pointer' : 'not-allowed', fontSize: '0.85rem' }}>
          {deleteBusy ? 'Deleting…' : 'Permanently delete'}
        </button>
        <button onClick={() => { setShowDelete(false); setDeleteConfirm(''); }} className="btn-secondary" style={{ padding: '8px 14px', fontSize: '0.85rem' }}>Cancel</button>
      </div>
      {deleteMsg && <span style={{ fontSize: '0.8rem', color: '#fca5a5' }}>{deleteMsg}</span>}
    </div>
  );
}
