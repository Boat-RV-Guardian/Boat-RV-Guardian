// Friends & Family sharing panel (Settings → Sharing tab). Extracted from Settings.tsx as part of
// the Task 3 split. Pure presentational: all sharing state + the create/accept/decline/remove/cancel/
// leave handlers stay in Settings and come in as props. Sharing constants/types are imported here.

import Login from '../Login';
import { ROLE_OPTIONS, ROLE_LABELS, getMyRole, type VehicleRole, type Invite, type Member } from '../../utils/sharing';

interface Props {
  user: any;
  showLogin: boolean;
  onShowLogin: (v: boolean) => void;
  shareMsg: { text: string; type: 'success' | 'error' } | null;
  onShareMsg: (msg: { text: string; type: 'success' | 'error' }) => void;
  pendingInvites: Invite[];
  friendsBusy: boolean;
  onAcceptInvite: (inv: Invite) => void;
  onDeclineInvite: (inv: Invite) => void;
  activeVehicleName: string;
  isActiveAdmin: boolean;
  hasActiveCloudVehicle: boolean;
  shareEmail: string;
  onShareEmailChange: (v: string) => void;
  shareRole: VehicleRole;
  onShareRoleChange: (v: VehicleRole) => void;
  onCreateInvite: () => void;
  lastInvite: Invite | null;
  activeMembers: Member[];
  activeVid: string;
  activeOwner: string | null;
  isActiveOwner: boolean;
  onTransferOwnership: (member: Member) => void;
  onRemoveMember: (vid: string, member: Member) => void;
  sentInvitesForActive: Invite[];
  onCancelInvite: (inviteId: string) => void;
  sharedWithMe: any[];
  onLeaveVehicle: (vid: string) => void;
}

export default function FriendsPanel(p: Props) {
  if (!p.user) {
    return (
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem' }}>👥</div>
        <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>Friends & Family Access</h3>
        <p style={{ color: 'var(--text-secondary)', maxWidth: '400px' }}>Sign in to share vehicle access with trusted friends or family.</p>
        {!p.showLogin ? (
          <button className="btn-primary" onClick={() => p.onShowLogin(true)}>Log into your account</button>
        ) : (
          <div style={{ marginTop: '12px', width: '100%', background: 'rgba(0,0,0,0.2)', padding: '15px', borderRadius: '12px' }}>
            <Login />
            <button className="btn-secondary" onClick={() => p.onShowLogin(false)} style={{ fontSize: '0.85rem', marginTop: '10px' }}>Cancel</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {p.shareMsg && (
        <div style={{ fontSize: '0.85rem', padding: '10px', borderRadius: '8px',
          color: p.shareMsg.type === 'success' ? '#10b981' : '#ef4444',
          background: p.shareMsg.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)' }}>
          {p.shareMsg.text}
        </div>
      )}

      {/* Pending invitations addressed to me */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>Pending Invitations</h3>
        {p.pendingInvites.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>No pending invitations. When someone shares a vehicle with you, it appears here to accept.</p>
        ) : p.pendingInvites.map(inv => (
          <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px' }}>
            <div style={{ fontSize: '0.85rem' }}>
              <strong>{inv.vehicleName}</strong> — {ROLE_LABELS[inv.role]}
              <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>from {inv.invitedByEmail}</div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn-primary" disabled={p.friendsBusy} onClick={() => p.onAcceptInvite(inv)} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>Accept</button>
              <button className="btn-secondary" disabled={p.friendsBusy} onClick={() => p.onDeclineInvite(inv)} style={{ padding: '6px 12px', fontSize: '0.8rem' }}>Decline</button>
            </div>
          </div>
        ))}
      </div>

      {/* Share a vehicle */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>Share <span style={{ color: 'var(--text-primary)' }}>{p.activeVehicleName}</span></h3>
        {!p.isActiveAdmin ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
            {p.hasActiveCloudVehicle
              ? 'Only an admin of the active vehicle can share it.'
              : 'The active vehicle isn’t synced to the cloud yet. Sign in and sync it to share.'}
          </p>
        ) : (
          <>
            <div>
              <label className="form-label">Friend's Email</label>
              <input className="form-input" type="email" value={p.shareEmail} onChange={e => p.onShareEmailChange(e.target.value)} placeholder="friend@example.com" />
            </div>
            <div>
              <label className="form-label">Privilege Level</label>
              <select className="form-input" value={p.shareRole} onChange={e => p.onShareRoleChange(e.target.value as VehicleRole)}>
                {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '6px 0 0 0' }}>
                {ROLE_OPTIONS.find(r => r.value === p.shareRole)?.desc}
              </p>
            </div>
            <button className="btn-primary" disabled={p.friendsBusy || !p.shareEmail} onClick={p.onCreateInvite}>
              {p.friendsBusy ? 'Working…' : 'Create Invite'}
            </button>

            {p.lastInvite && (
              <div style={{ background: 'rgba(0,242,254,0.06)', border: '1px solid rgba(0,242,254,0.3)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Send this to <strong>{p.lastInvite.inviteeEmail}</strong> (no email is sent automatically):
                </div>
                {(() => {
                  const msg = `You've been invited to "${p.lastInvite.vehicleName}" on Boat & RV Guardian as "${ROLE_LABELS[p.lastInvite.role]}". To accept: 1) Install Boat & RV Guardian, 2) Sign in with ${p.lastInvite.inviteeEmail}, 3) open Settings → Friends and accept the pending invitation.`;
                  return (
                    <>
                      <textarea readOnly value={msg} rows={4} className="form-input" style={{ fontSize: '0.8rem', resize: 'vertical' }} />
                      <button className="btn-secondary" style={{ fontSize: '0.8rem' }}
                        onClick={() => { try { navigator.clipboard?.writeText(msg); p.onShareMsg({ text: 'Invitation message copied to clipboard.', type: 'success' }); } catch { /* ignore */ } }}>
                        📋 Copy invitation message
                      </button>
                    </>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </div>

      {/* People with access to the ACTIVE vehicle */}
      {p.isActiveAdmin && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>People With Access</h3>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{p.activeVehicleName}</div>
          {p.activeMembers.map(m => (
            <div key={m.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', gap: '8px' }}>
              <span>
                {m.uid === p.activeOwner && <span title="Owner" style={{ marginRight: '4px' }}>👑</span>}
                {m.email} {m.uid === p.user.uid && <em style={{ color: 'var(--text-muted)' }}>(you)</em>} — {m.uid === p.activeOwner ? 'Owner' : ROLE_LABELS[m.role]}
              </span>
              {m.uid !== p.user.uid && (
                <span style={{ display: 'flex', gap: '6px' }}>
                  {p.isActiveOwner && m.uid !== p.activeOwner && (
                    <button className="btn-secondary" disabled={p.friendsBusy} onClick={() => p.onTransferOwnership(m)} style={{ padding: '4px 10px', fontSize: '0.75rem' }}>Make owner</button>
                  )}
                  <button className="btn-secondary" disabled={p.friendsBusy} onClick={() => p.onRemoveMember(p.activeVid, m)} style={{ padding: '4px 10px', fontSize: '0.75rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}>Revoke</button>
                </span>
              )}
            </div>
          ))}
          {p.sentInvitesForActive.map(inv => (
            <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              <span>{inv.inviteeEmail} — {ROLE_LABELS[inv.role]} <em>(pending)</em></span>
              <button className="btn-secondary" disabled={p.friendsBusy} onClick={() => p.onCancelInvite(inv.id)} style={{ padding: '4px 10px', fontSize: '0.75rem' }}>Cancel</button>
            </div>
          ))}
        </div>
      )}

      {/* Vehicles shared with me — leave/remove connection */}
      {p.sharedWithMe.length > 0 && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3 style={{ margin: 0, color: 'var(--accent-cyan)' }}>Shared With Me</h3>
          {p.sharedWithMe.map(cv => (
            <div key={cv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem' }}>
              <span><strong>{cv.lt_vessel_name || cv.id}</strong> — {ROLE_LABELS[getMyRole(cv) as VehicleRole]}</span>
              <button className="btn-secondary" disabled={p.friendsBusy} onClick={() => p.onLeaveVehicle(cv.id)} style={{ padding: '4px 10px', fontSize: '0.75rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}>Leave</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
