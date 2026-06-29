// Vehicle sharing (Friends tab) logic, extracted from Settings.tsx (Task 3). Owns the share-form
// state, the per-vehicle derived roles/members, the sent-invite refresh effect, and the
// create/accept/decline/remove/cancel/leave handlers. Pure cloud/Firestore logic — no device
// hardware. Settings passes in the live cloud vehicles + the active vehicle id + the active tab.

import { useState, useEffect } from 'react';
import { usePendingInvites } from './usePendingInvites';
import {
  getMyRole, getMembers, getOwner, createInvite, acceptInvite, declineInvite,
  cancelInvite, removeMember, leaveVehicle, listSentInvites, ensureOwnerAdmin, transferOwnership,
  type VehicleRole, type Invite, type Member,
} from '../utils/sharing';

interface Params {
  user: any;
  cloudVehicles: any[];
  activeVid: string;
  activeTab: string;
}

export function useVehicleSharing({ user, cloudVehicles, activeVid, activeTab }: Params) {
  const pendingInvites = usePendingInvites();
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<VehicleRole>('monitor');
  const [shareMsg, setShareMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [lastInvite, setLastInvite] = useState<Invite | null>(null);
  const [sentInvites, setSentInvites] = useState<Record<string, Invite[]>>({});
  const [friendsBusy, setFriendsBusy] = useState(false);

  // Vehicles I administer vs. ones shared with me (from the live cloud docs, which carry roles)
  const adminVehicles = (cloudVehicles || []).filter(cv => getMyRole(cv) === 'admin');
  const sharedWithMe = (cloudVehicles || []).filter(cv => { const r = getMyRole(cv); return r === 'control' || r === 'monitor'; });

  // Sharing is scoped to the ACTIVE vehicle only — you share whatever you're currently in.
  const activeCloudVehicle = (cloudVehicles || []).find(cv => cv.id === activeVid);
  const isActiveAdmin = activeCloudVehicle ? getMyRole(activeCloudVehicle) === 'admin' : false;
  // Ownership (a single owner, above Full Admin). Only the owner may transfer ownership.
  const activeOwner = getOwner(activeCloudVehicle);
  const isActiveOwner = !!user && (activeOwner === user.uid || (activeOwner == null && isActiveAdmin));
  const activeVehicleName = activeCloudVehicle?.lt_vessel_name || localStorage.getItem('lt_vessel_name') || 'this vehicle';
  // Members of the active vehicle. Legacy owners have no members map yet, so synthesize the
  // current admin (you) until ensureOwnerAdmin backfills the doc.
  const activeMembers: Member[] = (() => {
    const m = getMembers(activeCloudVehicle);
    if (user && isActiveAdmin && !m.some(x => x.uid === user.uid)) {
      return [{ uid: user.uid, role: 'admin', email: user.email || '(you)' }, ...m];
    }
    return m;
  })();

  // Load outstanding sent invites for each vehicle I administer
  const refreshSentInvites = async () => {
    const map: Record<string, Invite[]> = {};
    for (const cv of adminVehicles) {
      try { map[cv.id] = (await listSentInvites(cv.id)).filter(i => i.status === 'pending'); } catch { /* ignore */ }
    }
    setSentInvites(map);
  };
  useEffect(() => {
    if (activeTab === 'friends' && adminVehicles.length > 0) refreshSentInvites();
    // Backfill the owner's members entry on the active vehicle so People With Access lists them.
    if (activeTab === 'friends' && isActiveAdmin && activeVid) ensureOwnerAdmin(activeVid).catch(() => {});
  }, [activeTab, cloudVehicles.length]);

  const handleCreateInvite = async () => {
    setShareMsg(null);
    setLastInvite(null);
    if (!activeVid || !isActiveAdmin) { setShareMsg({ text: 'You must be an admin of the active vehicle to share it.', type: 'error' }); return; }
    setFriendsBusy(true);
    try {
      const name = activeCloudVehicle?.lt_vessel_name || localStorage.getItem('lt_vessel_name') || 'Vehicle';
      const invite = await createInvite(activeVid, name, shareEmail, shareRole);
      setLastInvite(invite);
      setShareEmail('');
      setShareMsg({ text: 'Invite created — share the message below with your friend.', type: 'success' });
      refreshSentInvites();
    } catch (e: any) {
      setShareMsg({ text: e.message || 'Failed to create invite', type: 'error' });
    } finally {
      setFriendsBusy(false);
    }
  };

  const handleAcceptInvite = async (invite: Invite) => {
    setFriendsBusy(true);
    try { await acceptInvite(invite); } catch (e: any) { setShareMsg({ text: e.message || 'Failed to accept', type: 'error' }); }
    finally { setFriendsBusy(false); }
  };
  const handleDeclineInvite = async (invite: Invite) => {
    setFriendsBusy(true);
    try { await declineInvite(invite.id); } catch { /* ignore */ } finally { setFriendsBusy(false); }
  };
  const handleRemoveMember = async (vid: string, member: Member) => {
    setFriendsBusy(true);
    try { await removeMember(vid, member.uid); } catch (e: any) { setShareMsg({ text: e.message || 'Failed to remove', type: 'error' }); }
    finally { setFriendsBusy(false); }
  };
  const handleCancelInvite = async (inviteId: string) => {
    setFriendsBusy(true);
    try { await cancelInvite(inviteId); refreshSentInvites(); } catch { /* ignore */ } finally { setFriendsBusy(false); }
  };
  const handleLeaveVehicle = async (vid: string) => {
    setFriendsBusy(true);
    try { await leaveVehicle(vid); } catch (e: any) { setShareMsg({ text: e.message || 'Failed to leave', type: 'error' }); }
    finally { setFriendsBusy(false); }
  };
  const handleTransferOwnership = async (member: Member) => {
    if (!confirm(`Transfer ownership of "${activeVehicleName}" to ${member.email}? They become the owner (Full Admin); you stay an admin until removed.`)) return;
    setShareMsg(null);
    setFriendsBusy(true);
    try {
      await transferOwnership(activeVid, member.uid, member.email);
      setShareMsg({ text: `Ownership transferred to ${member.email}.`, type: 'success' });
    } catch (e: any) { setShareMsg({ text: e.message || 'Failed to transfer ownership', type: 'error' }); }
    finally { setFriendsBusy(false); }
  };

  return {
    pendingInvites, shareEmail, setShareEmail, shareRole, setShareRole, shareMsg, setShareMsg,
    lastInvite, sentInvites, friendsBusy,
    adminVehicles, sharedWithMe, activeCloudVehicle, isActiveAdmin, activeVehicleName, activeMembers,
    activeOwner, isActiveOwner,
    handleCreateInvite, handleAcceptInvite, handleDeclineInvite, handleRemoveMember,
    handleCancelInvite, handleLeaveVehicle, handleTransferOwnership,
  };
}
