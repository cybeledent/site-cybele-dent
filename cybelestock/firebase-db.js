/* =========================================================
   CybèleStock — Firebase Firestore + Auth
   Application indépendante : ses données vivent dans le
   document "cybelestock" (collection "modules").
   La connexion utilise les mêmes comptes que les autres
   outils du cabinet (email / mot de passe).
   ========================================================= */
(function () {
  // Mode test local (aperçu sur l'ordinateur) : pas de connexion ni de cloud,
  // les données restent dans le navigateur.
  if (/^(localhost|127\.)/.test(location.hostname)) return;

  const firebaseConfig = {
    apiKey: "AIzaSyAzi5ULPrvOj76T6Nl3xp8yWT1gefZWJ_g",
    authDomain: "cybele-gestion.firebaseapp.com",
    projectId: "cybele-gestion",
    storageBucket: "cybele-gestion.firebasestorage.app",
    messagingSenderId: "370162109248",
    appId: "1:370162109248:web:08f019cee56f1dc6c3c8a5"
  };

  firebase.initializeApp(firebaseConfig);
  const db   = firebase.firestore();
  const auth = firebase.auth();

  // Session mémorisée sur l'appareil (reste connecté·e entre les visites)
  try { auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) {}

  window.CybeleDB = {
    /* ---- Firestore : lire / écrire l'état de l'application ---- */
    async load(key) {
      const snap = await db.collection("modules").doc(key).get();
      return snap.exists ? snap.data().state : null;
    },
    async save(key, data) {
      await db.collection("modules").doc(key).set({ state: data, ts: Date.now() });
    }
  };

  /* =========================================================
     AUTHENTIFICATION
     ========================================================= */
  let currentUser = null;
  let initialized = false;
  const changeCbs = [];
  let readyResolve;
  const readyPromise = new Promise(function (res) { readyResolve = res; });

  auth.onAuthStateChanged(function (user) {
    currentUser = user || null;
    initialized = true;
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
      "auth/missing-password": "Saisissez votre mot de passe.",
    };
    return map[code] || ("Erreur : " + (code || "inconnue"));
  }

  window.CybeleAuth = {
    available: true,
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
    frError: frError,
  };
})();
