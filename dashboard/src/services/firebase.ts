import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithRedirect, signInWithPopup, signInWithCredential, getRedirectResult } from 'firebase/auth';
import { initializeFirestore, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyC2h8iwGL05FJ6iP5_xCUON3oRm4hRGKos",
  authDomain: "boat-rv-guardian-9f8a4.firebaseapp.com",
  projectId: "boat-rv-guardian-9f8a4",
  storageBucket: "boat-rv-guardian-9f8a4.firebasestorage.app",
  messagingSenderId: "974787072340",
  appId: "1:974787072340:web:966f50042f524837fbb8c1",
  measurementId: "G-CM3RCHV5MR"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
// Force long-polling instead of gRPC streaming — gRPC/HTTP2 doesn't work in Tauri's WKWebView
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithRedirect,
  signInWithPopup,
  signInWithCredential,
  getRedirectResult,
  doc,
  setDoc,
  getDoc,
  onSnapshot
};
