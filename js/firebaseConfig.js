// firebaseConfig.js
const firebaseConfig = {
  apiKey: "AIzaSyCGr7f6BxxsOO1BJMxfdOF7wMjintKYwiY",
  authDomain: "kwlrintranet.firebaseapp.com",
  projectId: "kwlrintranet",
  storageBucket: "kwlrintranet.firebasestorage.app", // <-- IMPORTANT: use the real bucket
  messagingSenderId: "601132046075",
  appId: "1:601132046075:web:b840ed4a2187ab60e8825e",
  measurementId: "G-PK4MVBSJPB"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// Firestore
const db = firebase.firestore();
window.db = db;

// (Optional but recommended) expose a Storage instance that is pinned to the correct bucket.
// This guarantees all code paths use the right bucket even if anything else defaults incorrectly.
const STORAGE_BUCKET_URL = "gs://kwlrintranet.firebasestorage.app";
window.storage = firebase.app().storage(STORAGE_BUCKET_URL);

// Quick sanity log (you can remove this after verifying once)
try { console.log("[Storage bucket]", window.storage.ref().toString()); } catch(e) {}
