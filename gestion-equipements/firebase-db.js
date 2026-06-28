/* =========================================================
   CybèleGestion — Firebase Firestore
   Initialisation et helpers de persistance cloud.
   Les données sont stockées dans la collection "modules"
   (un document par module : "equipements", "personnel").
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
  const db = firebase.firestore();

  window.CybeleDB = {
    async load(key) {
      const snap = await db.collection("modules").doc(key).get();
      return snap.exists ? snap.data().state : null;
    },
    async save(key, data) {
      await db.collection("modules").doc(key).set({ state: data, ts: Date.now() });
    }
  };
})();
