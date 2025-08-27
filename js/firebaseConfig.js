// firebaseConfig.js
const firebaseConfig = {
  apiKey: "AIzaSyCGr7f6BxxsOO1BJMxfdOF7wMjintKYwiY",
  authDomain: "kwlrintranet.firebaseapp.com",
  projectId: "kwlrintranet",
  storageBucket: "kwlrintranet.firebasestorage.app",
  messagingSenderId: "601132046075",
  appId: "1:601132046075:web:b840ed4a2187ab60e8825e",
  measurementId: "G-PK4MVBSJPB"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();