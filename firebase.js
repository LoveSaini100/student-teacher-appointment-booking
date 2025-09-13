// js/firebase.js

// Import Firebase SDK modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Firebase config (from console)
export const firebaseConfig = {
  apiKey: "AIzaSyB6nZR0E66i438dAwoxM4x9Asvmn0xP9Us",
  authDomain: "student-teacher-booking-15ef2.firebaseapp.com",
  projectId: "student-teacher-booking-15ef2",
  storageBucket: "student-teacher-booking-15ef2.firebasestorage.app",
  messagingSenderId: "249743132343",
  appId: "1:249743132343:web:97ab9becc999ebc480af32"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

console.log("✅ Firebase initialized (v9 modular)");
 