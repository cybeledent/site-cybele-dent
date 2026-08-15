/* =========================================================
   CybèleGestion — Firebase Firestore + Storage + Auth
   - Auth      : connexion sécurisée (email/mot de passe)
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
  const auth    = firebase.auth();

  // Session mémorisée sur l'appareil (reste connecté·e entre les visites)
  try { auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) {}

  // Application secondaire : sert à créer des comptes salariés
  // SANS déconnecter le manager en cours.
  let secondaryApp = null;
  function secondary() {
    if (!secondaryApp) secondaryApp = firebase.initializeApp(firebaseConfig, "secondary");
    return secondaryApp;
  }

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

  /* =========================================================
     AUTHENTIFICATION
     ========================================================= */
  let currentUser = null;
  let initialized = false;
  const changeCbs = [];
  let readyResolve;
  let readyPromise = new Promise(function (res) { readyResolve = res; });

  auth.onAuthStateChanged(function (user) {
    currentUser = user || null;
    initialized = true;
    // On résout la promesse « prêt » dès qu'un·e utilisateur·rice est connecté·e,
    // et on ne la réinitialise JAMAIS : la déconnexion recharge la page (état propre),
    // donc les modules déjà en attente sont bien réveillés au moment du login.
    if (user) { readyResolve(user); }
    changeCbs.forEach(function (cb) { try { cb(currentUser); } catch (e) {} });
  });

  // Normalise les messages d'erreur Firebase en français
  function frError(err) {
    const code = (err && err.code) || "";
    const map = {
      "auth/invalid-email": "Identifiant invalide.",
      "auth/user-disabled": "Ce compte est désactivé.",
      "auth/user-not-found": "Identifiant ou mot de passe incorrect.",
      "auth/wrong-password": "Identifiant ou mot de passe incorrect.",
      "auth/invalid-credential": "Identifiant ou mot de passe incorrect.",
      "auth/too-many-requests": "Trop de tentatives. Réessayez dans quelques minutes.",
      "auth/network-request-failed": "Problème de connexion internet.",
      "auth/email-already-in-use": "Un compte existe déjà avec cet identifiant.",
      "auth/weak-password": "Mot de passe trop court (6 caractères minimum).",
      "auth/operation-not-allowed": "L'authentification par email n'est pas activée côté Firebase.",
      "auth/configuration-not-found": "L'authentification n'est pas encore activée côté Firebase (à faire dans la console).",
      "auth/missing-password": "Saisissez votre mot de passe.",
    };
    return map[code] || ("Erreur : " + (code || "inconnue"));
  }

  window.CybeleAuth = {
    available: true,
    // promesse résolue dès qu'un·e utilisateur·rice est connecté·e
    whenReady: function () { return readyPromise; },
    isReady: function () { return initialized; },
    currentUser: function () { return currentUser; },
    email: function () { return currentUser ? currentUser.email : null; },
    onChange: function (cb) {
      changeCbs.push(cb);
      if (initialized) { try { cb(currentUser); } catch (e) {} }
    },
    signIn: function (email, pwd) {
      return auth.signInWithEmailAndPassword(String(email).trim(), pwd);
    },
    signOut: function () { return auth.signOut(); },
    sendReset: function (email) { return auth.sendPasswordResetEmail(String(email).trim()); },
    // Crée un compte salarié sans toucher à la session du manager
    createUser: async function (email, pwd) {
      const sec = secondary();
      const cred = await sec.auth().createUserWithEmailAndPassword(String(email).trim(), pwd);
      try { await sec.auth().signOut(); } catch (e) {}
      return cred.user;
    },
    frError: frError,
  };
})();
