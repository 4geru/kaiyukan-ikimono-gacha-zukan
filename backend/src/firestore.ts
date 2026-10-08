import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (getApps().length === 0) {
  initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
}

export const db = getFirestore();
