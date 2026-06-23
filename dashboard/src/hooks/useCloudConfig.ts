import { useState, useEffect } from 'react';
import { db, auth, doc, onSnapshot, setDoc } from '../services/firebase';
import { collection, query, where, arrayUnion, arrayRemove } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

export interface UserConfig {
  accessibleVehicles: string[];
  activeVehicleId: string;
  // What to open on login: 'default' = always the activeVehicleId vehicle; 'last' = whatever was
  // used last on this device. Unset is treated as 'default' (honor the chosen vehicle).
  startupMode?: 'default' | 'last';
}

export function useCloudConfig(activeVid: string | null) {
  const [userConfig, setUserConfig] = useState<UserConfig | null>(null);
  const [activeVehicleConfig, setActiveVehicleConfig] = useState<Record<string, any> | null>(null);
  // The vehicle id that activeVehicleConfig currently corresponds to. Null until the
  // snapshot for the current activeVid has arrived. SyncModal uses this to guarantee it
  // never compares one vehicle's cloud data against another vehicle's local config.
  const [configVid, setConfigVid] = useState<string | null>(null);
  const [cloudVehicles, setCloudVehicles] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);

  // Subscribe to user document and accessible vehicles
  useEffect(() => {
    let unsubscribeUser: (() => void) | undefined;
    let unsubscribeVehicles: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeUser) {
        unsubscribeUser();
        unsubscribeUser = undefined;
      }
      if (unsubscribeVehicles) {
        unsubscribeVehicles();
        unsubscribeVehicles = undefined;
      }

      if (!user) {
        setUserConfig(null);
        setActiveVehicleConfig(null);
        setCloudVehicles([]);
        setLoading(false);
        return;
      }

      const userRef = doc(db, 'users', user.uid);
      unsubscribeUser = onSnapshot(userRef, (snap) => {
        if (snap.exists()) {
          setUserConfig(snap.data() as UserConfig);
        } else {
          setUserConfig({ accessibleVehicles: [], activeVehicleId: '' });
        }
      });

      const q = query(collection(db, 'vehicles'), where('allowedUsers', 'array-contains', user.uid));
      unsubscribeVehicles = onSnapshot(q, (snapshot: any) => {
        const vehicles: Record<string, any>[] = [];
        snapshot.forEach((doc: any) => {
          vehicles.push({ id: doc.id, ...doc.data() });
        });
        setCloudVehicles(vehicles);
        setLoading(false);
      });
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUser) unsubscribeUser();
      if (unsubscribeVehicles) unsubscribeVehicles();
    };
  }, []);

  // Subscribe to active vehicle document
  useEffect(() => {
    if (!activeVid) {
      setActiveVehicleConfig(null);
      setConfigVid(null);
      return;
    }

    // Clear stale data immediately so SyncModal doesn't compare against the wrong vehicle.
    // configVid stays out of sync with activeVid until the snapshot below arrives, which is
    // exactly the signal SyncModal needs to wait for.
    setActiveVehicleConfig(null);
    setConfigVid(null);
    setLoading(true);

    const vehicleRef = doc(db, 'vehicles', activeVid);
    const unsubscribeVehicle = onSnapshot(vehicleRef, (snap) => {
      setActiveVehicleConfig(snap.exists() ? snap.data() : {});
      setConfigVid(activeVid);
      setLoading(false);
    });

    return () => unsubscribeVehicle();
  }, [activeVid]);

  const updateUserConfig = async (newConfig: Partial<UserConfig>) => {
    if (!auth.currentUser) throw new Error('Must be logged in');
    const docRef = doc(db, 'users', auth.currentUser.uid);
    await setDoc(docRef, newConfig, { merge: true });
  };

  const updateVehicleConfig = async (vid: string, newConfig: Record<string, any>) => {
    if (!auth.currentUser) throw new Error('Must be logged in');
    const docRef = doc(db, 'vehicles', vid);
    await setDoc(docRef, {
      ...newConfig,
      allowedUsers: arrayUnion(auth.currentUser.uid)
    }, { merge: true });
  };

  // Remove the current user from a vehicle's allowedUsers so it stops matching the
  // array-contains query (and therefore stops being re-hydrated into the local map).
  const deleteVehicleConfig = async (vid: string) => {
    if (!auth.currentUser) return;
    const docRef = doc(db, 'vehicles', vid);
    await setDoc(docRef, {
      allowedUsers: arrayRemove(auth.currentUser.uid)
    }, { merge: true });
  };

  return { userConfig, activeVehicleConfig, configVid, cloudVehicles, updateUserConfig, updateVehicleConfig, deleteVehicleConfig, loading };
}
