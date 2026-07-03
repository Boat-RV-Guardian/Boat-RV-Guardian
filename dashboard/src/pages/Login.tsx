import { useState, useEffect } from 'react';
import { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, signOut, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signInWithCredential, getRedirectResult } from '../services/firebase';
import { getAdditionalUserInfo, type UserCredential } from 'firebase/auth';
import { isEmailVerifyExempt } from '../utils/emailVerification';
import { open } from '@tauri-apps/plugin-shell';
import { start, onUrl, cancel } from '@fabianlars/tauri-plugin-oauth';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Restore a login error that was set just before a reload (e.g. a bounced Google login that deleted
  // the auto-created account and triggered the per-user wipe + reload).
  useEffect(() => {
    try {
      const m = sessionStorage.getItem('login_error');
      if (m) { setError(m); sessionStorage.removeItem('login_error'); }
    } catch { /* ignore */ }
  }, []);

  // Complete a signInWithRedirect round-trip. When the web popup is blocked we fall back to a
  // full-page redirect; on return Firebase has the result here. signInWithCredential (onAuthStateChanged)
  // updates the app, so we only surface errors and clear the in-flight loading state.
  useEffect(() => {
    let active = true;
    getRedirectResult(auth)
      .catch((err: any) => {
        if (active) setError(err?.message || 'Google authentication failed');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        // Send a verification email (best-effort; a failure shouldn't block sign-up). Google users
        // never hit this path — they're already verified. The test domain is exempt so automated
        // testing can create throwaway accounts without a real inbox.
        if (!isEmailVerifyExempt(email)) {
          try { await sendEmailVerification(cred.user); } catch { /* best-effort */ }
        }
      }
    } catch (err: any) {
      const code = err?.code || '';
      if (isLogin && (code === 'auth/user-not-found' || code === 'auth/invalid-credential')) {
        setError('No account found for that email. Tap "Need an account? Sign Up" to create one.');
      } else if (!isLogin && code === 'auth/email-already-in-use') {
        setError('An account already exists for that email. Switch to Sign In.');
      } else {
        setError(err.message || 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
  };

  // Enforce login-vs-signup for federated (Google) sign-in, which otherwise auto-creates an account.
  // In LOGIN mode, a brand-new Google user means "no account yet" → undo the auto-create and tell them
  // to sign up. Returns true if the sign-in is accepted. (Signup mode accepts new or existing.)
  const enforceMode = async (cred: UserCredential): Promise<boolean> => {
    if (!isLogin) return true;
    if (getAdditionalUserInfo(cred)?.isNewUser) {
      const msg = 'No account found for that Google account. Switch to "Sign Up" to create one.';
      // Persist across the reload that deleting the user triggers (per-user wipe), so the user sees why.
      try { sessionStorage.setItem('login_error', msg); } catch { /* ignore */ }
      setError(msg);
      try { await cred.user.delete(); } catch { await signOut(auth).catch(() => {}); }
      return false;
    }
    return true;
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      // Check if we are running inside the Tauri native app
      if ((window as any).__TAURI_INTERNALS__) {
        // Clean up any dangling server from a previously aborted flow
        try {
          await cancel(14205);
        } catch (e) {
          // ignore if it fails to cancel (wasn't running)
        }

        // Start local OAuth server
        const port = await start({ ports: [14205], response: 'Authentication successful! You can close this tab and return to the app.' });
        
        let unlisten: () => void;
        unlisten = await onUrl(async (url) => {
          if (unlisten) unlisten();
          try {
            await cancel(port);
          } catch (e) {
            // Server already shut down automatically upon receiving the URL
          }
          
          try {
            const hashMatch = url.match(/#(.+)/);
            if (hashMatch) {
              const params = new URLSearchParams(hashMatch[1]);
              const idToken = params.get('id_token');
              
              if (idToken) {
                const credential = GoogleAuthProvider.credential(idToken);
                const cred = await signInWithCredential(auth, credential);
                await enforceMode(cred);
                setLoading(false);
                return;
              } else {
                // If it came back with an error from Google
                const errorParam = params.get('error') || new URLSearchParams(url.split('?')[1]).get('error');
                if (errorParam) {
                   setError(`Google returned an error: ${errorParam}`);
                   setLoading(false);
                   return;
                }
              }
            }
            
            setError('Failed to extract Google login token. URL was: ' + url.substring(0, 50) + '...');
          } catch (cbErr: any) {
            console.error('Callback error:', cbErr);
            setError(cbErr.message || 'Error signing into Firebase with Google token.');
          } finally {
            setLoading(false);
          }
        });

        // Open system default browser
        const clientId = '974787072340-6f8m5lu120avq3j1o2pgipqeh7fnsd3r.apps.googleusercontent.com';
        const redirectUri = `http://127.0.0.1:${port}/`;
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=id_token&scope=email%20profile%20openid&nonce=12345`;
        
        await open(authUrl);
      } else if (Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios') {
        // Run native capacitor plugin sign in
        const result = await FirebaseAuthentication.signInWithGoogle();
        if (result.credential?.idToken) {
          const credential = GoogleAuthProvider.credential(result.credential.idToken);
          const cred = await signInWithCredential(auth, credential);
          await enforceMode(cred);
        } else {
          setError('Failed to obtain Google ID Token from Native Auth');
        }
        setLoading(false);
      } else {
        // Running in a standard web browser. Prefer the popup, but it gets blocked by popup
        // blockers, in embedded/in-app webviews, and on some mobile browsers — fall back to a
        // full-page redirect there (completed by the getRedirectResult effect above).
        const provider = new GoogleAuthProvider();
        try {
          const cred = await signInWithPopup(auth, provider);
          await enforceMode(cred);
          setLoading(false);
        } catch (popupErr: any) {
          const code = popupErr?.code || '';
          if (code === 'auth/popup-closed-by-user') {
            // User deliberately dismissed the popup — treat as a silent cancel, don't redirect away.
            setLoading(false);
          } else if (
            code === 'auth/popup-blocked' ||
            code === 'auth/cancelled-popup-request' ||
            code === 'auth/operation-not-supported-in-environment'
          ) {
            // Popup unavailable (blocker / in-app webview) — fall back to a full-page redirect.
            // Navigates away; loading stays true until the page returns to getRedirectResult.
            await signInWithRedirect(auth, provider);
          } else {
            throw popupErr;
          }
        }
      }
    } catch (err: any) {
      console.error('OAuth Error:', err);
      const errMsg = typeof err === 'string' ? err : (err?.message || 'Google authentication failed');
      setError(errMsg);
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%', backgroundColor: 'var(--bg)' }}>
      <div className="card" style={{ width: '100%', maxWidth: '400px', padding: '30px' }}>
        <h2 style={{ color: 'var(--accent)', textAlign: 'center', marginBottom: '20px' }}>
          {isLogin ? 'Guardian Login' : 'Create Account'}
        </h2>

        {error && (
          <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '10px', borderRadius: '8px', marginBottom: '15px', fontSize: '0.9rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '5px', color: 'var(--text-muted)' }}>Email</label>
            <input 
              type="email" 
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.2)', color: '#fff' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '5px', color: 'var(--text-muted)' }}>Password</label>
            <input 
              type="password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.2)', color: '#fff' }}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: '10px' }}>
            {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Sign Up')}
          </button>
        </form>

        <div style={{ margin: '20px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
          <span style={{ padding: '0 10px', fontSize: '0.85rem' }}>OR</span>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
        </div>

        <button 
          type="button" 
          onClick={handleGoogleSignIn}
          disabled={loading}
          style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', fontWeight: 'bold', transition: 'background-color 0.2s' }}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/><path d="M1 1h22v22H1z" fill="none"/></svg>
          Continue with Google
        </button>

        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '0.9rem' }}>
          <button 
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            style={{ background: 'none', border: 'none', color: 'var(--accent-blue)', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {isLogin ? 'Need an account? Sign Up' : 'Already have an account? Sign In'}
          </button>
        </div>
      </div>
    </div>
  );
}
