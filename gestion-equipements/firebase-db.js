/* =========================================================
   CybèleGestion — Firebase Firestore + Storage
   - Firestore : données (équipements, personnel)
   - Storage   : photos et documents binaires
   ========================================================= */
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyAzi5ULPrvOj76T6Nl3xp8yWT1gefZWJ_g",
    authDomain: "cybele-gestion.firebaseapp.com",
    projectId: "cybele-gestion",
    storageBucket: "cybele-gestion.firebasestorage.app",
    messagingSenderId: "370162109248",
    appId: "1:370162109248:web:08f019cee56f1dc6c3c8a5"
  };

  firebase.initializeApp(firebaseConfig);
  const db      = firebase.firestore();
  const storage = firebase.storage();

  window.CybeleDB = {
    /* ---- Firestore : lire / écrire un module ---- */
    async load(key) {
      const snap = await db.collection("modules").doc(key).get();
      return snap.exists ? snap.data().state : null;
    },
    async save(key, data) {
      await db.collection("modules").doc(key).set({ state: data, ts: Date.now() });
    },

    /* ---- Storage : upload d'un fichier binaire ---- */
    async uploadFile(path, blob) {
      const ref = storage.ref(path);
      await ref.put(blob);
      return await ref.getDownloadURL();
    },

    /* ---- Storage : suppression d'un fichier par URL ---- */
    async deleteFile(url) {
      try { await storage.refFromURL(url).delete(); } catch (e) { /* déjà supprimé ou URL locale */ }
    }
  };
})();
