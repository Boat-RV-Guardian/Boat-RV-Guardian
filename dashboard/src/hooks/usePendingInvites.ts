import { useState, useEffect } from 'react';
import { auth, db, onSnapshot } from '../services/firebase';
import { collection, query, where } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import type { Invite } from '../utils/sharing';

// Live list of pending invitations addressed to the signed-in user's email.
// Invites are discovered by email match (not auto-applied) so the user can accept/decline.
export function usePendingInvites(): Invite[] {
  const [invites, setInvites] = useState<Invite[]>([]);

  useEffect(() => {
    let unsub: (() => void) | undefined;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsub) { unsub(); unsub = undefined; }
      if (!user?.email) { setInvites([]); return; }

      const q = query(
        collection(db, 'invites'),
        where('inviteeEmail', '==', user.email.trim().toLowerCase()),
        where('status', '==', 'pending'),
      );
      unsub = onSnapshot(q, (snap: any) => {
        setInvites(snap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as Invite[]);
      }, () => setInvites([]));
    });

    return () => { unsubAuth(); if (unsub) unsub(); };
  }, []);

  return invites;
}
