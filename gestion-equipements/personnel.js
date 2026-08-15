/* =========================================================
   CybèleGestion — Module Personnel / RH
   Planning, badgeuse, congés, heures, export paie.
   Données locales (localStorage) — clé cybele-personnel-v1.
   ========================================================= */
(function () {
  "use strict";

  const STORE_KEY = "cybele-personnel-v1";

  const ROLES = ["Praticien", "Assistant(e)", "Secrétaire", "Autre"];
  const ABSENCE_TYPES = ["Congé payé", "RTT", "Absence", "Maladie", "Formation"];
  const PLANNING_TYPES = {
    present:   { label: "Présent",   cls: "present",  ico: "🟢" },
    repos:     { label: "Repos",     cls: "repos",    ico: "⚪" },
    conge:     { label: "Congé",     cls: "conge",    ico: "🌴" },
    absence:   { label: "Absence",   cls: "absence",  ico: "🟠" },
    maladie:   { label: "Maladie",   cls: "maladie",  ico: "🔴" },
    formation: { label: "Formation", cls: "formation",ico: "🎓" },
  };
  const COLORS = ["#e07a5f", "#3a6ea5", "#16a36a", "#9b5de5", "#c98a14", "#d6453f", "#0ca5a5"];
  const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const MOIS_C = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

  // Vacances scolaires ZONE A (dont Lyon) — dates officielles (data.education.gouv.fr),
  // exprimées en calendrier local : la période court de `du` (inclus) à `au` (= reprise, exclu).
  const VACANCES_ZONE_A = [
    // Année scolaire 2025-2026
    { nom: "Vacances de la Toussaint", du: "2025-10-18", au: "2025-11-03" },
    { nom: "Vacances de Noël",         du: "2025-12-20", au: "2026-01-05" },
    { nom: "Vacances d'hiver",         du: "2026-02-07", au: "2026-02-23" },
    { nom: "Vacances de printemps",    du: "2026-04-04", au: "2026-04-20" },
    { nom: "Pont de l'Ascension",      du: "2026-05-14", au: "2026-05-18" },
    { nom: "Vacances d'été",           du: "2026-07-04", au: "2026-09-01" },
    // Année scolaire 2026-2027
    { nom: "Vacances de la Toussaint", du: "2026-10-17", au: "2026-11-02" },
    { nom: "Vacances de Noël",         du: "2026-12-19", au: "2027-01-04" },
    { nom: "Vacances d'hiver",         du: "2027-02-13", au: "2027-03-01" },
    { nom: "Vacances de printemps",    du: "2027-04-10", au: "2027-04-26" },
    { nom: "Pont de l'Ascension",      du: "2027-05-07", au: "2027-05-08" },
    { nom: "Vacances d'été",           du: "2027-07-03", au: "2027-09-01" },
    // Année scolaire 2027-2028 (arrêté du 21 juillet 2026)
    { nom: "Vacances de la Toussaint", du: "2027-10-23", au: "2027-11-08" },
    { nom: "Vacances de Noël",         du: "2027-12-18", au: "2028-01-03" },
    { nom: "Vacances d'hiver",         du: "2028-02-19", au: "2028-03-06" },
    { nom: "Vacances de printemps",    du: "2028-04-22", au: "2028-05-09" },
    { nom: "Pont de l'Ascension",      du: "2028-05-26", au: "2028-05-29" },
    { nom: "Vacances d'été",           du: "2028-07-08", au: "2028-09-04" },
  ];

  /* =========================================================
     ÉTAT
     ========================================================= */
  let state = null;
  let sessionUser = null; // membre connecté pour cette session
  let view = { tab: "dashboard", weekStart: mondayOf(new Date()), monthRef: ymOf(new Date()) };
  let clockTimer = null;

  function loadLocal() {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) {}
    return null;
  }
  function migrate(s) {
    s.membres = s.membres || []; s.planning = s.planning || []; s.pointages = s.pointages || [];
    s.demandes = s.demandes || []; s.reglages = s.reglages || defaultReglages();
    s.fermetures = s.fermetures || [];
    // Chaque membre est salarié·e par défaut (sauf praticien) → congés décomptés lors des fermetures
    s.membres.forEach(m => {
      if (m.salarie === undefined) m.salarie = m.role !== "Praticien";
      if (m.login === undefined) m.login = ""; // identifiant du compte de connexion associé
    });
    // Complète les réglages manquants (rétro-compat)
    if (s.reglages.afficherWeekend === undefined) s.reglages.afficherWeekend = false;
    if (!Array.isArray(s.reglages.creneauxDefaut) || !s.reglages.creneauxDefaut.length)
      s.reglages.creneauxDefaut = [{ debut: "09:00", fin: "13:00" }, { debut: "14:00", fin: "18:00" }];
    // Si aucun manager défini, auto-détecte par le nom "Filipputti"
    if (!s.membres.some(m => m.isManager)) {
      const f = s.membres.find(m => m.nom === "Filipputti");
      if (f) f.isManager = true;
    }
    // Normalise les horaires vers le format à créneaux multiples
    s.planning.forEach(p => {
      if (p.type === "present" && !Array.isArray(p.creneaux)) {
        p.creneaux = (p.debut && p.fin) ? [{ debut: p.debut, fin: p.fin }] : [];
      }
    });
    return s;
  }
  function defaultReglages() { return { heuresSemaineDefaut: 35, congesAnnuelDefaut: 25, pauseDejeunerMin: 60, afficherWeekend: false, creneauxDefaut: [{ debut: "09:00", fin: "13:00" }, { debut: "14:00", fin: "18:00" }] }; }
  function save() {
    // Sauvegarde locale
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast("⚠ Mémoire pleine."); }
    // Synchronisation Firestore
    if (window.CybeleDB) {
      window.CybeleDB.save("personnel", state).catch(() => {});
    }
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* =========================================================
     DONNÉES D'EXEMPLE
     ========================================================= */
  function seed() {
    const m1 = uid(), m2 = uid(), m3 = uid(), m4 = uid(), m5 = uid();
    const mon = mondayOf(new Date());
    const dd = (i) => isoAdd(mon, i);
    const mk = (id, prenom, nom, role, binomeId, couleur, pin, h) =>
      ({ id, prenom, nom, role, binomeId, couleur, pin, heuresSemaine: h, congesAcquis: 25, actif: true, salarie: role !== "Praticien" });

    const membres = [
      { ...mk(m1, "Céline", "Filipputti", "Praticien", m3, COLORS[0], "1111", 39), isManager: true },
      mk(m2, "Laura", "Agosto", "Praticien", m4, COLORS[1], "2222", 35),
      mk(m3, "Sophie", "Martin", "Assistant(e)", m1, COLORS[2], "3333", 35),
      mk(m4, "Julie", "Bernard", "Assistant(e)", m2, COLORS[3], "4444", 35),
      mk(m5, "Nadia", "Lopez", "Secrétaire", "", COLORS[4], "5555", 28),
    ];

    // Planning de la semaine courante (Lun-Ven présents 9h-18h, secrétaire 8h30-16h30)
    const planning = [];
    membres.forEach(mb => {
      for (let i = 0; i < 5; i++) {
        const present = !(mb.id === m4 && i === 2); // Julie en formation mercredi
        if (mb.id === m4 && i === 2) { planning.push({ id: uid(), membreId: mb.id, date: dd(i), type: "formation", debut: "", fin: "", note: "Formation implanto" }); continue; }
        planning.push({ id: uid(), membreId: mb.id, date: dd(i), type: "present", debut: mb.id === m5 ? "08:30" : "09:00", fin: mb.id === m5 ? "16:30" : "18:00", note: "" });
      }
    });

    // Quelques pointages réels d'aujourd'hui (un en cours, un terminé, un oublié)
    const todayISO = iso(new Date());
    const pointages = [
      { id: uid(), membreId: m1, date: todayISO, arrivee: atToday(8, 58), depart: "", pauseMin: 0 },        // en cours
      { id: uid(), membreId: m3, date: todayISO, arrivee: atToday(9, 2), depart: atToday(13, 5), pauseMin: 0 }, // matin fait
    ];

    const demandes = [
      { id: uid(), membreId: m3, type: "Congé payé", dateDebut: dd(12), dateFin: dd(16), motif: "Vacances", statut: "en_attente", createdAt: new Date().toISOString() },
      { id: uid(), membreId: m5, type: "RTT", dateDebut: dd(8), dateFin: dd(8), motif: "", statut: "en_attente", createdAt: new Date().toISOString() },
      { id: uid(), membreId: m4, type: "Congé payé", dateDebut: dd(-20), dateFin: dd(-16), motif: "", statut: "valide", createdAt: new Date().toISOString() },
    ];

    const yr = new Date().getFullYear();
    const fermetures = [{ id: uid(), nom: "Fermeture estivale", du: yr + "-08-03", au: yr + "-08-14" }];

    return { membres, planning, pointages, demandes, fermetures, reglages: defaultReglages() };
  }

  /* =========================================================
     UTILITAIRES DATE / HEURE
     ========================================================= */
  // Dates au format calendrier LOCAL (évite le décalage UTC qui cassait isoAdd)
  function pad2(n) { return String(n).padStart(2, "0"); }
  function iso(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function ymOf(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1); }
  function mondayOf(d) {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    const day = (x.getDay() + 6) % 7; // 0 = lundi
    x.setDate(x.getDate() - day);
    return iso(x);
  }
  function isoAdd(isoStr, days) { const d = new Date(isoStr + "T00:00:00"); d.setDate(d.getDate() + days); return iso(d); }
  function atToday(h, m) { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); }
  function fmtDate(isoStr) {
    if (!isoStr) return "—";
    const d = new Date(isoStr + "T00:00:00");
    if (isNaN(d)) return isoStr;
    return d.getDate() + " " + MOIS_C[d.getMonth()] + " " + d.getFullYear();
  }
  function fmtDateShort(isoStr) { const d = new Date(isoStr + "T00:00:00"); return d.getDate() + " " + MOIS_C[d.getMonth()]; }
  function parseHM(s) { if (!s) return null; const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); }
  function fmtHM(min) { if (min == null) return "—"; const h = Math.floor(Math.abs(min) / 60), m = Math.round(Math.abs(min) % 60); return (min < 0 ? "-" : "") + h + "h" + (m ? String(m).padStart(2, "0") : ""); }
  function fmtTime(isoDt) { if (!isoDt) return "—"; const d = new Date(isoDt); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function workdaysBetween(a, b) { // jours ouvrés Lun-Ven inclus
    let n = 0, d = new Date(a + "T00:00:00"), end = new Date(b + "T00:00:00");
    while (d <= end) { const wd = d.getDay(); if (wd !== 0 && wd !== 6) n++; d.setDate(d.getDate() + 1); }
    return n;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  /* ---- Jours fériés (France) + vacances scolaires Zone A ---- */
  function easterSunday(y) { // algorithme de Meeus/Jones/Butcher (grégorien)
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  const _feriesCache = {};
  function feriesOf(year) {
    if (_feriesCache[year]) return _feriesCache[year];
    const f = {}, add = (dt, n) => { f[iso(dt)] = n; };
    add(new Date(year, 0, 1), "Jour de l'an");
    add(new Date(year, 4, 1), "Fête du travail");
    add(new Date(year, 4, 8), "Victoire 1945");
    add(new Date(year, 6, 14), "Fête nationale");
    add(new Date(year, 7, 15), "Assomption");
    add(new Date(year, 10, 1), "Toussaint");
    add(new Date(year, 10, 11), "Armistice");
    add(new Date(year, 11, 25), "Noël");
    const e = easterSunday(year), off = (n) => { const x = new Date(e); x.setDate(x.getDate() + n); return x; };
    add(off(1), "Lundi de Pâques");
    add(off(39), "Ascension");
    add(off(50), "Lundi de Pentecôte");
    return (_feriesCache[year] = f);
  }
  function ferieNom(isoStr) { return feriesOf(Number(isoStr.slice(0, 4)))[isoStr] || null; }
  function vacancesNom(isoStr) { const v = VACANCES_ZONE_A.find(p => isoStr >= p.du && isoStr < p.au); return v ? v.nom : null; }
  // Fermeture du cabinet couvrant une date (bornes incluses)
  function fermetureFor(isoStr) { return (state.fermetures || []).find(f => isoStr >= f.du && isoStr <= f.au) || null; }

  function membre(id) { return state.membres.find(m => m.id === id); }
  function membreNom(id) { const m = membre(id); return m ? m.prenom + " " + m.nom : "—"; }
  function initiales(m) { return (m.prenom[0] || "") + (m.nom[0] || ""); }

  /* ---- Calculs heures ---- */
  function pointageMinutes(p) {
    if (!p.arrivee || !p.depart) return 0;
    return Math.max(0, (new Date(p.depart) - new Date(p.arrivee)) / 60000 - (p.pauseMin || 0));
  }
  function realMinutesIn(membreId, dFrom, dTo) {
    return state.pointages.filter(p => p.membreId === membreId && p.date >= dFrom && p.date <= dTo && p.depart)
      .reduce((s, p) => s + pointageMinutes(p), 0);
  }
  // Créneaux horaires d'une entrée de planning (supporte l'ancien format debut/fin
  // et le nouveau format à créneaux multiples creneaux:[{debut,fin}, ...])
  function creneauxOf(e) {
    if (!e) return [];
    if (Array.isArray(e.creneaux) && e.creneaux.length) return e.creneaux.filter(c => c && c.debut && c.fin);
    if (e.debut && e.fin) return [{ debut: e.debut, fin: e.fin }];
    return [];
  }
  function entryMinutes(e) {
    return creneauxOf(e).reduce((s, c) => { const a = parseHM(c.debut), b = parseHM(c.fin); return s + (a != null && b != null ? Math.max(0, b - a) : 0); }, 0);
  }
  function plannedMinutesIn(membreId, dFrom, dTo) {
    // Ni les jours fériés ni les fermetures du cabinet ne sont décomptés
    return state.planning.filter(p => p.membreId === membreId && p.type === "present" && p.date >= dFrom && p.date <= dTo && !ferieNom(p.date) && !fermetureFor(p.date))
      .reduce((s, p) => s + entryMinutes(p), 0);
  }
  function openPointage(membreId) {
    return state.pointages.find(p => p.membreId === membreId && p.arrivee && !p.depart);
  }
  function congesPris(membreId) { // jours ouvrés de congés validés sur l'année courante
    const year = new Date().getFullYear();
    const demandes = state.demandes.filter(d => d.membreId === membreId && d.statut === "valide" && /Cong|RTT/.test(d.type) && d.dateDebut.startsWith(String(year)))
      .reduce((s, d) => s + workdaysBetween(d.dateDebut, d.dateFin), 0);
    return demandes + fermetureCongeDays(membreId, year);
  }
  // Jours ouvrés (hors fériés) de fermeture décomptés en congés pour un·e salarié·e
  function fermetureCongeDays(membreId, year) {
    const m = membre(membreId);
    if (!m || !m.salarie) return 0;
    const y = String(year || new Date().getFullYear());
    let total = 0;
    (state.fermetures || []).forEach(f => {
      let cur = f.du, guard = 0;
      while (cur <= f.au && guard++ < 800) {
        const wd = new Date(cur + "T00:00:00").getDay();
        if (wd !== 0 && wd !== 6 && cur.startsWith(y) && !ferieNom(cur)) total++;
        cur = isoAdd(cur, 1);
      }
    });
    return total;
  }
  function soldeConges(m) { return (m.congesAcquis || 0) - congesPris(m.id); }

  /* =========================================================
     PETITS COMPOSANTS UI (modale, toast)
     ========================================================= */
  const modalRoot = document.getElementById("modal-root");

  function openModal(title, bodyHTML, onSave, saveLabel) {
    modalRoot.innerHTML = `
      <div class="modal-overlay"><div class="modal" role="dialog">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close">✕</button></div>
        <div class="modal-body">${bodyHTML}</div>
        <div class="modal-foot">
          <button class="btn btn-soft" data-cancel>Annuler</button>
          <button class="btn btn-primary" data-save>${esc(saveLabel || "Enregistrer")}</button>
        </div>
      </div></div>`;
    const ov = modalRoot.querySelector(".modal-overlay");
    const close = () => { modalRoot.innerHTML = ""; };
    ov.querySelector(".modal-close").onclick = close;
    ov.querySelector("[data-cancel]").onclick = close;
    ov.onclick = (e) => { if (e.target === ov) close(); };
    ov.querySelector("[data-save]").onclick = () => { if (onSave(ov) !== false) close(); };
    const f = ov.querySelector("input,select,textarea"); if (f) f.focus();
    return ov;
  }
  function val(ov, n) { const el = ov.querySelector(`[name="${n}"]`); return el ? el.value.trim() : ""; }
  function fText(n, l, v, o) { o = o || {}; return `<div class="field"><label>${esc(l)}</label><input type="${o.type || "text"}" name="${n}" value="${esc(v || "")}" placeholder="${esc(o.ph || "")}"></div>`; }
  function fSelect(n, l, v, opts) { return `<div class="field"><label>${esc(l)}</label><select name="${n}">${opts.map(o => { const val = typeof o === "string" ? o : o.v, lab = typeof o === "string" ? o : o.l; return `<option value="${esc(val)}" ${val === v ? "selected" : ""}>${esc(lab)}</option>`; }).join("")}</select></div>`; }
  function fArea(n, l, v) { return `<div class="field"><label>${esc(l)}</label><textarea name="${n}">${esc(v || "")}</textarea></div>`; }

  let toastTimer;
  function toast(msg) {
    if (window.CybeleShell && window.CybeleShell.flash) return window.CybeleShell.flash(msg);
    clearTimeout(toastTimer);
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg; toastTimer = setTimeout(() => el.remove(), 2600);
  }

  /* =========================================================
     RENDU
     ========================================================= */
  const root = document.getElementById("app-personnel");

  // Associe automatiquement le compte connecté (Firebase) au membre correspondant
  function autoSelectSession() {
    if (sessionUser || !state) return;
    if (!window.CybeleAuth || !window.CybeleAuth.email) return;
    const email = (window.CybeleAuth.email() || "").toLowerCase();
    if (!email) return;
    const m = state.membres.find(x => (x.login || "").toLowerCase() === email);
    if (m) sessionUser = m;
  }

  function render() {
    if (!state) return;
    if (!sessionUser) autoSelectSession();
    if (!sessionUser) { renderLogin(); return; }
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    root.innerHTML = `
      <div class="session-bar">
        <span>👤 ${esc(sessionUser.prenom)} ${esc(sessionUser.nom)}${sessionUser.isManager ? " · <strong>Employeur</strong>" : ""}</span>
        <button class="btn-ghost-sm" data-pact="logout">Déconnecter</button>
      </div>
      <div class="p-subnav">
        ${subTab("dashboard", "📊 Tableau de bord")}
        ${subTab("planning", "🗓 Planning")}
        ${subTab("badgeuse", "⏱ Badgeuse")}
        ${subTab("temps", "📈 Temps de travail")}
        ${subTab("demandes", "✅ Demandes")}
        ${subTab("membres", "👤 Membres")}
      </div>
      <div id="p-content"></div>`;
    renderTab();
    window.scrollTo(0, 0);
  }

  function renderLogin() {
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    const membres = (state.membres || []).filter(m => m.actif !== false);
    root.innerHTML = `
      <div style="max-width:380px;margin:60px auto;padding:0 16px">
        <div class="card" style="padding:28px 24px">
          <h2 style="margin-bottom:4px;font-size:1.2rem">👥 Module Personnel</h2>
          <p style="color:var(--muted);margin-bottom:22px;font-size:.9rem">Identifiez-vous pour accéder au module.</p>
          <div class="field">
            <label>Qui êtes-vous ?</label>
            <select id="login-membre">
              <option value="">— Sélectionnez votre nom —</option>
              ${membres.map(m => `<option value="${m.id}">${esc(m.prenom)} ${esc(m.nom)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Code PIN</label>
            <input type="password" id="login-pin" inputmode="numeric" maxlength="6"
              placeholder="••••" style="letter-spacing:.3em;font-size:1.2rem;text-align:center">
          </div>
          <button class="btn btn-primary" id="login-btn" style="width:100%;justify-content:center;margin-top:4px">Accéder →</button>
          <p id="login-err" style="color:#c0392b;font-size:.85rem;margin-top:10px;display:none">Code PIN incorrect.</p>
        </div>
      </div>`;
    const doLogin = () => {
      const membreId = root.querySelector("#login-membre").value;
      const pin = root.querySelector("#login-pin").value.trim();
      if (!membreId) { toast("Sélectionnez votre nom."); return; }
      const m = state.membres.find(x => x.id === membreId);
      if (!m || m.pin !== pin) {
        root.querySelector("#login-err").style.display = "block";
        root.querySelector("#login-pin").value = "";
        root.querySelector("#login-pin").focus();
        return;
      }
      sessionUser = m;
      render();
    };
    root.querySelector("#login-btn").onclick = doLogin;
    root.querySelector("#login-pin").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  }
  function subTab(id, label) {
    const n = id === "demandes" ? state.demandes.filter(d => d.statut === "en_attente").length : 0;
    return `<button class="p-subtab ${view.tab === id ? "active" : ""}" data-ptab="${id}">${label}${n ? ` <span class="p-badge">${n}</span>` : ""}</button>`;
  }
  function renderTab() {
    const c = document.getElementById("p-content");
    if (view.tab === "dashboard") c.innerHTML = viewDashboard();
    else if (view.tab === "planning") c.innerHTML = viewPlanning();
    else if (view.tab === "badgeuse") { c.innerHTML = viewBadgeuse(); startClock(); }
    else if (view.tab === "temps") c.innerHTML = viewTemps();
    else if (view.tab === "demandes") c.innerHTML = viewDemandes();
    else if (view.tab === "membres") c.innerHTML = viewMembres();
  }

  /* ---- Avatar ---- */
  function avatar(m, size) {
    return `<span class="p-avatar" style="background:${m.couleur};width:${size || 36}px;height:${size || 36}px;font-size:${(size || 36) * 0.38}px">${esc(initiales(m))}</span>`;
  }

  /* =========================================================
     VUE — TABLEAU DE BORD
     ========================================================= */
  function viewDashboard() {
    const today = iso(new Date());
    const enAttente = state.demandes.filter(d => d.statut === "en_attente");
    const presents = state.membres.filter(m => openPointage(m.id));
    // pointages oubliés : présent prévu aujourd'hui mais aucun pointage commencé
    const oublis = ferieNom(today) ? [] : state.membres.filter(m => {
      const prevu = state.planning.some(p => p.membreId === m.id && p.date === today && p.type === "present");
      const pointe = state.pointages.some(p => p.membreId === m.id && p.date === today);
      const hour = new Date().getHours();
      return prevu && !pointe && hour >= 10; // alerte après 10h
    });
    // dépassements de la semaine (réel > contrat)
    const wkEnd = isoAdd(view.weekStart, 6);
    const depass = state.membres.map(m => {
      const real = realMinutesIn(m.id, mondayOf(new Date()), today);
      return { m, real, contrat: (m.heuresSemaine || 0) * 60 };
    }).filter(x => x.real > x.contrat && x.contrat > 0);

    const stat = (n, label, cls) => `<div class="p-stat ${cls || ""}"><div class="p-stat-n">${n}</div><div class="p-stat-l">${label}</div></div>`;

    return `
      <div class="p-stats">
        ${stat(state.membres.filter(m => m.actif).length, "Membres actifs")}
        ${stat(presents.length, "Présents maintenant", "ok")}
        ${stat(enAttente.length, "Demandes en attente", enAttente.length ? "warn" : "")}
        ${stat(oublis.length, "Pointages oubliés", oublis.length ? "danger" : "")}
      </div>

      <div class="p-cols">
        <div class="p-col">
          <div class="tab-section-label">Présents actuellement</div>
          ${presents.length ? presents.map(m => {
            const p = openPointage(m.id);
            const min = (Date.now() - new Date(p.arrivee)) / 60000;
            return `<div class="plain-card ok-bg"><div class="pc-icon green">${avatar(m, 30)}</div>
              <div class="pc-body"><div class="pc-title">${esc(membreNom(m.id))}</div>
              <div class="pc-meta">Arrivé·e à ${fmtTime(p.arrivee)} · ${fmtHM(min)} de présence</div></div>
              <span class="due-badge ok">En poste</span></div>`;
          }).join("") : `<p class="pc-meta">Personne n'est pointé pour le moment.</p>`}
        </div>

        <div class="p-col">
          <div class="tab-section-label">Alertes</div>
          ${oublis.map(m => `<div class="plain-card late"><div class="pc-icon red">⏰</div>
            <div class="pc-body"><div class="pc-title">Pointage oublié</div>
            <div class="pc-meta">${esc(membreNom(m.id))} était prévu·e aujourd'hui sans pointage.</div></div>
            <button class="link-action" data-pact="goto-badgeuse">Badger</button></div>`).join("")}
          ${depass.map(x => `<div class="plain-card"><div class="pc-icon amber">📈</div>
            <div class="pc-body"><div class="pc-title">Heures dépassées</div>
            <div class="pc-meta">${esc(membreNom(x.m.id))} : ${fmtHM(x.real)} réalisées cette semaine (contrat ${x.m.heuresSemaine}h).</div></div>
            <span class="due-badge warn">+${fmtHM(x.real - x.contrat)}</span></div>`).join("")}
          ${(!oublis.length && !depass.length) ? `<p class="pc-meta">Aucune alerte. ✅</p>` : ""}
        </div>
      </div>

      ${enAttente.length ? `
        <div class="tab-section-label" style="margin-top:22px">Demandes à traiter</div>
        ${enAttente.map(demandeCard).join("")}` : ""}
    `;
  }

  /* =========================================================
     VUE — PLANNING (semaine)
     ========================================================= */
  function viewPlanning() {
    const ws = view.weekStart;
    const nDays = state.reglages.afficherWeekend ? 7 : 5;
    const days = Array.from({ length: nDays }, (_, i) => isoAdd(ws, i));
    const todayI = iso(new Date());
    // Infos jour férié / fermeture cabinet / vacances scolaires (Zone A) par date
    const dayInfo = days.map(d => ({ ferie: ferieNom(d), ferm: fermetureFor(d), vac: vacancesNom(d) }));

    const head = `<div class="pl-row pl-head">
      <div class="pl-name">Membre</div>
      ${days.map((d, i) => {
        const info = dayInfo[i];
        const cls = (d === todayI ? "today " : "") + (info.ferie ? "pl-ferie" : info.ferm ? "pl-fermeture" : info.vac ? "pl-vacances" : "");
        const meta = info.ferie ? `<span class="pl-daymeta ferie" title="${esc(info.ferie)}">${esc(info.ferie)}</span>`
          : info.ferm ? `<span class="pl-daymeta ferm" title="Fermeture : ${esc(info.ferm.nom)}">🔒 Fermé</span>`
          : info.vac ? `<span class="pl-daymeta vac" title="${esc(info.vac)}">🌴 Vacances</span>` : "";
        return `<div class="pl-cell pl-dayhead ${cls}">${JOURS[i]}<span>${fmtDateShort(d)}</span>${meta}</div>`;
      }).join("")}
    </div>`;

    const rows = state.membres.filter(m => m.actif).map(m => {
      const cells = days.map((d, i) => {
        const info = dayInfo[i];
        // Jour férié : cabinet fermé, aucune planification possible (écrase l'existant)
        if (info.ferie) return `<div class="pl-cell pl-ferie-cell pl-col-ferie" data-pferie="${esc(info.ferie)}" title="Jour férié — ${esc(info.ferie)} (cabinet fermé)"><span class="pl-type">🎌 Férié</span><span class="pl-hours">Fermé</span></div>`;
        // Fermeture du cabinet : fermé pour tous ; salarié·e = congé décompté
        if (info.ferm) {
          return m.salarie
            ? `<div class="pl-cell pl-conge pl-ferm-conge" data-pferm="${esc(info.ferm.nom)}" title="Fermeture : ${esc(info.ferm.nom)} — congé"><span class="pl-type">🌴 Congé</span><span class="pl-hours">Fermeture</span></div>`
            : `<div class="pl-cell pl-ferm-closed" data-pferm="${esc(info.ferm.nom)}" title="Fermeture : ${esc(info.ferm.nom)}"><span class="pl-type">🔒 Fermé</span><span class="pl-hours">${esc(info.ferm.nom)}</span></div>`;
        }
        const colCls = info.vac ? " pl-col-vac" : "";
        const e = state.planning.find(p => p.membreId === m.id && p.date === d);
        if (!e) return `<div class="pl-cell pl-empty${colCls}" data-pcell="${m.id}|${d}">+</div>`;
        const t = PLANNING_TYPES[e.type] || PLANNING_TYPES.present;
        const cx = e.type === "present" ? creneauxOf(e) : [];
        const hours = cx.map(c => `<span class="pl-hours">${c.debut}–${c.fin}</span>`).join("");
        return `<div class="pl-cell pl-${t.cls}${colCls}" data-pcell="${m.id}|${d}" title="${esc(t.label)}${e.note ? " — " + esc(e.note) : ""}">
          <span class="pl-type">${t.ico} ${t.label}</span>${hours}</div>`;
      }).join("");
      const total = fmtHM(plannedMinutesIn(m.id, days[0], days[nDays - 1]));
      return `<div class="pl-row">
        <div class="pl-name">${avatar(m, 32)}<div><div class="pl-mn">${esc(m.prenom)} ${esc(m.nom)}</div><div class="pl-mr">${esc(m.role)} · prévu ${total}</div></div></div>
        ${cells}</div>`;
    }).join("");

    return `
      <div class="pl-toolbar">
        <button class="btn-nav" data-pact="week-prev">‹</button>
        <div class="pl-week">Semaine du ${fmtDate(ws)}</div>
        <button class="btn-nav" data-pact="week-next">›</button>
        <button class="btn btn-soft" data-pact="week-today">Aujourd'hui</button>
        <button class="btn btn-soft" data-pact="params-planning">⚙ Horaires par défaut</button>
        <button class="btn btn-soft" data-pact="fermetures">🔒 Fermetures</button>
        <button class="btn btn-soft" data-pact="print-planning">🖨 Imprimer</button>
        <span style="flex:1"></span>
        <div class="pl-legend">${Object.values(PLANNING_TYPES).map(t => `<span class="pl-leg pl-${t.cls}">${t.ico} ${t.label}</span>`).join("")}</div>
      </div>
      <div class="print-title">Cabinet dentaire Cybèle Dent — Planning de la semaine du ${fmtDate(ws)}</div>
      ${state.membres.filter(m => m.actif).length ? `<div class="pl-grid ${nDays === 7 ? "d7" : "d5"}">${head}${rows}</div>` : emptyBox("👤", "Aucun membre", "Ajoutez d'abord des membres dans l'onglet « Membres ».")}
      <p class="pc-meta pl-tip" style="margin-top:10px">Astuce : cliquez sur une case pour définir présence (un ou plusieurs créneaux), congé, absence…</p>
    `;
  }

  /* =========================================================
     VUE — BADGEUSE (kiosque)
     ========================================================= */
  function viewBadgeuse() {
    const today = iso(new Date());
    const todayPts = state.pointages.filter(p => p.date === today);
    return `
      <div class="badge-kiosk">
        <div class="badge-clock" id="badge-clock">--:--:--</div>
        <div class="badge-date">${jourComplet(new Date())}</div>
        <p class="pc-meta" style="text-align:center;margin-bottom:18px">Sélectionnez votre nom pour pointer votre arrivée ou votre départ.</p>
        <div class="badge-grid">
          ${state.membres.filter(m => m.actif).map(m => {
            const op = openPointage(m.id);
            return `<button class="badge-card ${op ? "in" : ""}" data-pbadge="${m.id}">
              ${avatar(m, 52)}
              <div class="badge-name">${esc(m.prenom)}<br>${esc(m.nom)}</div>
              <div class="badge-state">${op ? "🟢 En poste depuis " + fmtTime(op.arrivee) + ' <span class="badge-elapsed" data-since="' + op.arrivee + '"></span>' : "⚪ Pointer l'arrivée"}</div>
            </button>`;
          }).join("")}
        </div>
        <div class="tab-section-label" style="margin-top:26px">Pointages du jour</div>
        ${todayPts.length ? todayPts.slice().reverse().map(p => `<div class="plain-card">
          <div class="pc-icon ${p.depart ? "green" : "amber"}">${avatar(membre(p.membreId), 30)}</div>
          <div class="pc-body"><div class="pc-title">${esc(membreNom(p.membreId))}</div>
          <div class="pc-meta">Arrivée ${fmtTime(p.arrivee)}${p.depart ? " · Départ " + fmtTime(p.depart) + " · " + fmtHM(pointageMinutes(p)) : " · en cours…"}</div></div>
          ${p.depart ? `<span class="due-badge ok">${fmtHM(pointageMinutes(p))}</span>` : `<span class="due-badge warn">En cours</span>`}
        </div>`).join("") : `<p class="pc-meta">Aucun pointage aujourd'hui.</p>`}
      </div>`;
  }
  function jourComplet(d) {
    const jn = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"][d.getDay()];
    return jn.charAt(0).toUpperCase() + jn.slice(1) + " " + d.getDate() + " " + MOIS[d.getMonth()] + " " + d.getFullYear();
  }
  function startClock() {
    const tick = () => {
      const el = document.getElementById("badge-clock");
      if (!el) { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } return; }
      const d = new Date();
      el.textContent = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, "0")).join(":");
      document.querySelectorAll(".badge-elapsed").forEach(s => {
        const min = (Date.now() - new Date(s.dataset.since)) / 60000;
        s.textContent = "(" + fmtHM(min) + ")";
      });
    };
    tick();
    clockTimer = setInterval(tick, 1000);
  }
  function pointer(m) {
    const op = openPointage(m.id);
    const pin = prompt(`Code PIN de ${m.prenom} ${m.nom} :`);
    if (pin === null) return;
    if (String(pin) !== String(m.pin)) { toast("Code PIN incorrect."); return; }
    if (op) {
      op.depart = new Date().toISOString();
      save(); toast(`Départ enregistré — ${fmtHM(pointageMinutes(op))} travaillées.`);
    } else {
      state.pointages.push({ id: uid(), membreId: m.id, date: iso(new Date()), arrivee: new Date().toISOString(), depart: "", pauseMin: 0 });
      save(); toast(`Bonjour ${m.prenom}, arrivée enregistrée.`);
    }
    renderTab(); startClock();
  }

  /* =========================================================
     VUE — TEMPS DE TRAVAIL (mois)
     ========================================================= */
  function viewTemps() {
    const ym = view.monthRef;
    const [y, mo] = ym.split("-").map(Number);
    const from = ym + "-01";
    const to = iso(new Date(y, mo, 0)); // dernier jour du mois
    const rows = state.membres.filter(m => m.actif).map(m => {
      const real = realMinutesIn(m.id, from, to);
      const prevu = plannedMinutesIn(m.id, from, to);
      const jours = new Set(state.pointages.filter(p => p.membreId === m.id && p.date >= from && p.date <= to && p.depart).map(p => p.date)).size;
      const contratMois = (m.heuresSemaine || 0) * 60 * 52 / 12;
      const sup = Math.max(0, real - contratMois);
      const ecart = real - prevu;
      return { m, real, prevu, jours, sup, ecart };
    });
    return `
      <div class="pl-toolbar">
        <button class="btn-nav" data-pact="month-prev">‹</button>
        <div class="pl-week">${MOIS[mo - 1]} ${y}</div>
        <button class="btn-nav" data-pact="month-next">›</button>
        <span style="flex:1"></span>
        <button class="btn btn-primary" data-pact="export-paie">⬇ Export paie (CSV)</button>
      </div>
      <div class="t-table-wrap"><table class="t-table">
        <thead><tr><th>Membre</th><th>Jours</th><th>Prévu</th><th>Réel</th><th>Écart</th><th>Heures sup.</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td class="t-name">${avatar(r.m, 28)} ${esc(r.m.prenom)} ${esc(r.m.nom)}</td>
            <td>${r.jours}</td>
            <td>${fmtHM(r.prevu)}</td>
            <td><strong>${fmtHM(r.real)}</strong></td>
            <td class="${r.ecart < 0 ? "t-neg" : "t-pos"}">${r.ecart >= 0 ? "+" : ""}${fmtHM(r.ecart)}</td>
            <td>${r.sup > 0 ? `<span class="due-badge warn">${fmtHM(r.sup)}</span>` : "—"}</td>
          </tr>`).join("")}
        </tbody>
      </table></div>
      <p class="pc-meta" style="margin-top:10px">« Réel » = heures pointées à la badgeuse. « Heures sup. » = au-delà du contrat mensualisé. L'export CSV est prêt à envoyer au comptable.</p>
    `;
  }

  function exportPaie() {
    const ym = view.monthRef, [y, mo] = ym.split("-").map(Number);
    const from = ym + "-01", to = iso(new Date(y, mo, 0));
    const sep = ";";
    const lines = [["Membre", "Role", "Jours travailles", "Heures prevues", "Heures reelles", "Heures sup", "Conges pris (annee)", "Solde conges"].join(sep)];
    state.membres.filter(m => m.actif).forEach(m => {
      const real = realMinutesIn(m.id, from, to), prevu = plannedMinutesIn(m.id, from, to);
      const jours = new Set(state.pointages.filter(p => p.membreId === m.id && p.date >= from && p.date <= to && p.depart).map(p => p.date)).size;
      const sup = Math.max(0, real - (m.heuresSemaine || 0) * 60 * 52 / 12);
      const h = (min) => (min / 60).toFixed(2).replace(".", ",");
      lines.push([m.prenom + " " + m.nom, m.role, jours, h(prevu), h(real), h(sup), congesPris(m.id), soldeConges(m)].join(sep));
    });
    const csv = "﻿" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "paie-" + ym + ".csv";
    a.click(); URL.revokeObjectURL(a.href);
    toast("Export paie téléchargé (" + MOIS[mo - 1] + " " + y + ").");
  }

  /* =========================================================
     VUE — DEMANDES
     ========================================================= */
  function viewDemandes() {
    const dem = state.demandes.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    const att = dem.filter(d => d.statut === "en_attente");
    const autres = dem.filter(d => d.statut !== "en_attente");
    return `
      <div class="section-add" style="margin-bottom:16px"><button class="btn btn-primary" data-pact="add-demande">＋ Nouvelle demande</button></div>
      <div class="tab-section-label">En attente (${att.length})</div>
      ${att.length ? att.map(demandeCard).join("") : `<p class="pc-meta">Aucune demande en attente.</p>`}
      <div class="tab-section-label" style="margin-top:22px">Historique</div>
      ${autres.length ? autres.map(demandeCard).join("") : `<p class="pc-meta">Aucune demande traitée.</p>`}
    `;
  }
  function demandeCard(d) {
    const m = membre(d.membreId);
    const jours = workdaysBetween(d.dateDebut, d.dateFin);
    const period = d.dateDebut === d.dateFin ? fmtDate(d.dateDebut) : fmtDate(d.dateDebut) + " → " + fmtDate(d.dateFin);
    const stBadge = d.statut === "valide" ? `<span class="due-badge ok">Validée</span>` :
      d.statut === "refuse" ? `<span class="due-badge late">Refusée</span>` : `<span class="due-badge warn">En attente</span>`;
    const isManager = sessionUser && sessionUser.isManager;
    const isOwnPending = sessionUser && d.membreId === sessionUser.id && d.statut === "en_attente";
    const actions = d.statut === "en_attente"
      ? (isManager
          ? `<button class="btn-mini ok" data-valide="${d.id}">✓ Valider</button>
             <button class="btn-mini no" data-refuse="${d.id}">✕ Refuser</button>
             <button class="icon-btn del" data-del-demande="${d.id}" title="Supprimer">🗑</button>`
          : (isOwnPending ? `<button class="icon-btn del" data-del-demande="${d.id}" title="Annuler ma demande">🗑</button>` : ""))
      : (isManager ? `<button class="icon-btn del" data-del-demande="${d.id}">🗑</button>` : "");
    return `<div class="plain-card ${d.statut === "en_attente" ? "" : "ok-bg"}">
      <div class="pc-icon ${d.statut === "valide" ? "green" : d.statut === "refuse" ? "red" : "amber"}">${m ? avatar(m, 30) : "📩"}</div>
      <div class="pc-body">
        <div class="pc-title">${esc(membreNom(d.membreId))} — ${esc(d.type)} <span class="pc-meta">(${jours} j ouvré${jours > 1 ? "s" : ""})</span></div>
        <div class="pc-meta">${period}${d.motif ? " · " + esc(d.motif) : ""}</div>
      </div>
      <div class="pc-actions">
        ${stBadge}
        ${actions}
      </div>
    </div>`;
  }

  /* =========================================================
     VUE — MEMBRES
     ========================================================= */
  function viewMembres() {
    const isMgr = sessionUser && sessionUser.isManager;
    const authOn = !!(window.CybeleAuth && window.CybeleAuth.available);
    return `
      <div class="section-add" style="margin-bottom:16px"><button class="btn btn-primary" data-pact="add-membre">＋ Nouveau membre</button></div>
      ${state.membres.length ? state.membres.map(m => {
        const bin = m.binomeId ? membre(m.binomeId) : null;
        const solde = soldeConges(m);
        const compte = m.login ? `🔑 ${esc(m.login)}` : `<span style="color:var(--warn)">🔑 pas de compte</span>`;
        return `<div class="plain-card ${m.actif ? "" : "off"}">
          <div class="pc-icon" style="background:transparent">${avatar(m, 40)}</div>
          <div class="pc-body">
            <div class="pc-title">${esc(m.prenom)} ${esc(m.nom)} <span class="tag tag-type">${esc(m.role)}</span> ${m.salarie ? "" : '<span class="tag tag-place">non-salarié·e</span>'} ${!m.actif ? '<span class="tag tag-cat-poubelle">Inactif</span>' : ""}</div>
            <div class="pc-meta">${m.heuresSemaine}h/sem.${bin ? " · 👥 " + esc(bin.prenom + " " + bin.nom) : ""} · 🌴 <strong>${solde} j</strong> (pris ${congesPris(m.id)}/${m.congesAcquis}) · PIN ${esc(m.pin)}</div>
            ${authOn ? `<div class="pc-meta" style="margin-top:2px">${compte}</div>` : ""}
          </div>
          <div class="pc-actions">
            ${authOn && isMgr ? `<button class="icon-btn" data-compte-membre="${m.id}" title="Compte de connexion">🔑</button>` : ""}
            <button class="icon-btn" data-edit-membre="${m.id}">✎</button>
            <button class="icon-btn del" data-del-membre="${m.id}">🗑</button>
          </div>
        </div>`;
      }).join("") : emptyBox("👤", "Aucun membre", "Ajoutez les praticiens, assistant·es et secrétaires du cabinet.")}
      ${authOn && isMgr ? `<p class="pc-meta" style="margin-top:12px">🔑 Créez un compte de connexion pour chaque personne (identifiant + mot de passe). Elles s'y connecteront depuis leur téléphone.</p>` : ""}
    `;
  }

  function emptyBox(ico, title, txt) {
    return `<div class="empty"><div class="em-ico">${ico}</div><h3>${esc(title)}</h3><p>${esc(txt)}</p></div>`;
  }

  /* =========================================================
     MODALES
     ========================================================= */
  function modalMembre(m) {
    const isNew = !m;
    m = m || { prenom: "", nom: "", role: "Assistant(e)", binomeId: "", couleur: COLORS[state.membres.length % COLORS.length], pin: String(1000 + Math.floor(Math.random() * 9000)), heuresSemaine: state.reglages.heuresSemaineDefaut, congesAcquis: state.reglages.congesAnnuelDefaut, actif: true, salarie: true };
    const others = state.membres.filter(x => x.id !== m.id);
    const body = `
      <div class="field-row">${fText("prenom", "Prénom *", m.prenom)}${fText("nom", "Nom *", m.nom)}</div>
      <div class="field-row">${fSelect("role", "Rôle", m.role, ROLES)}
        ${fSelect("binomeId", "Binôme", m.binomeId, [{ v: "", l: "— Aucun —" }].concat(others.map(o => ({ v: o.id, l: o.prenom + " " + o.nom }))))}</div>
      <div class="field-row">${fText("heuresSemaine", "Heures / semaine", m.heuresSemaine, { type: "number" })}${fText("congesAcquis", "Congés acquis (jours/an)", m.congesAcquis, { type: "number" })}</div>
      <div class="field-row">${fText("pin", "Code PIN (badgeuse)", m.pin)}
        <div class="field"><label>Couleur</label><input type="color" name="couleur" value="${m.couleur}" style="height:44px;padding:4px"></div></div>
      <label class="chk-line" style="margin-bottom:14px"><input type="checkbox" name="salarie" ${m.salarie ? "checked" : ""}> Salarié·e — mis·e en congés lors des fermetures du cabinet</label>
      ${fSelect("actif", "Statut", m.actif ? "Actif" : "Inactif", ["Actif", "Inactif"])}
    `;
    openModal(isNew ? "Nouveau membre" : "Modifier le membre", body, (ov) => {
      const prenom = val(ov, "prenom"), nom = val(ov, "nom");
      if (!prenom || !nom) { toast("Prénom et nom obligatoires."); return false; }
      const data = {
        prenom, nom, role: val(ov, "role"), binomeId: val(ov, "binomeId"),
        heuresSemaine: parseFloat(val(ov, "heuresSemaine")) || 0, congesAcquis: parseFloat(val(ov, "congesAcquis")) || 0,
        pin: val(ov, "pin"), couleur: val(ov, "couleur"), actif: val(ov, "actif") === "Actif",
        salarie: ov.querySelector("[name=salarie]").checked,
      };
      if (isNew) { const id = uid(); state.membres.push({ id, ...data }); reciprBinome(id, data.binomeId); }
      else { Object.assign(m, data); reciprBinome(m.id, data.binomeId); }
      save(); renderTab();
    }, isNew ? "Créer" : "Enregistrer");
  }
  function reciprBinome(id, binomeId) { // lien réciproque
    state.membres.forEach(x => { if (x.binomeId === id && x.id !== binomeId) x.binomeId = ""; });
    if (binomeId) { const b = membre(binomeId); if (b) b.binomeId = id; }
  }

  /* ---- Compte de connexion d'un membre (manager) ---- */
  function slugLogin(m) {
    const noAccent = (m.prenom || "membre").normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "");
    const base = noAccent.toLowerCase().replace(/[^a-z0-9]/g, "");
    return (base || "membre") + "@cybele-dent.fr";
  }
  function modalCompte(m) {
    if (!m) return;
    if (!sessionUser || !sessionUser.isManager) { toast("Réservé à l'employeur."); return; }
    if (!window.CybeleAuth) { toast("Authentification indisponible."); return; }
    const hasLogin = !!m.login;
    const body = hasLogin
      ? `<p class="pc-meta" style="margin-bottom:12px">${esc(m.prenom)} ${esc(m.nom)}</p>
         <div class="plain-card ok-bg"><div class="pc-icon green">🔑</div><div class="pc-body"><div class="pc-title">Compte associé</div><div class="pc-meta">${esc(m.login)}</div></div></div>
         <p class="pc-meta" style="margin:12px 0 8px">Cette personne se connecte avec cet identifiant et son mot de passe.</p>
         <button type="button" class="btn-line" id="cpt-reset" style="margin-bottom:8px">✉ Envoyer un email de réinitialisation du mot de passe</button>
         <button type="button" class="btn-line" id="cpt-unlink">✕ Retirer l'association</button>`
      : `<p class="pc-meta" style="margin-bottom:12px">${esc(m.prenom)} ${esc(m.nom)} — aucun compte pour l'instant.</p>
         <div class="field"><label>Identifiant</label><input type="email" name="login" value="${esc(slugLogin(m))}"></div>
         <div class="field"><label>Mot de passe (6 caractères min.)</label><input type="text" name="pwd" value="" placeholder="ex. Cybele2026"></div>
         <p class="field-hint">⚠ Notez ce mot de passe pour le communiquer à la personne.</p>
         <button type="button" class="btn btn-primary" id="cpt-create" style="width:100%;justify-content:center;margin-top:6px">Créer le compte &amp; associer</button>
         <button type="button" class="btn-line" id="cpt-link" style="margin-top:8px">Le compte existe déjà → juste l'associer</button>`;
    const ov = openModal("Compte de connexion", body, () => {}, "Fermer");
    const cancel = ov.querySelector("[data-cancel]"); if (cancel) cancel.style.display = "none";

    if (hasLogin) {
      ov.querySelector("#cpt-reset").onclick = () => {
        window.CybeleAuth.sendReset(m.login)
          .then(() => toast("Email de réinitialisation envoyé (si l'identifiant est un vrai email)."))
          .catch(e => toast(window.CybeleAuth.frError(e)));
      };
      ov.querySelector("#cpt-unlink").onclick = () => {
        if (confirm("Retirer l'association ? La personne ne sera plus reconnue via ce membre (le compte lui-même reste, à supprimer côté Firebase si besoin).")) {
          m.login = ""; save(); modalRoot.innerHTML = ""; renderTab();
        }
      };
    } else {
      ov.querySelector("#cpt-create").onclick = async () => {
        const login = ov.querySelector("[name=login]").value.trim().toLowerCase();
        const pwd = ov.querySelector("[name=pwd]").value;
        if (!login) { toast("Saisissez un identifiant."); return; }
        if (pwd.length < 6) { toast("Mot de passe : 6 caractères minimum."); return; }
        const btn = ov.querySelector("#cpt-create"); btn.disabled = true; btn.textContent = "Création…";
        try {
          await window.CybeleAuth.createUser(login, pwd);
          m.login = login; save(); modalRoot.innerHTML = ""; renderTab();
          toast("Compte créé — identifiant : " + login);
        } catch (e) {
          if (e && e.code === "auth/email-already-in-use") {
            m.login = login; save(); modalRoot.innerHTML = ""; renderTab();
            toast("Ce compte existait déjà — identifiant associé.");
          } else {
            btn.disabled = false; btn.textContent = "Créer le compte & associer";
            toast(window.CybeleAuth.frError(e));
          }
        }
      };
      ov.querySelector("#cpt-link").onclick = () => {
        const login = ov.querySelector("[name=login]").value.trim().toLowerCase();
        if (!login) { toast("Saisissez l'identifiant existant."); return; }
        m.login = login; save(); modalRoot.innerHTML = ""; renderTab();
        toast("Identifiant associé.");
      };
    }
  }

  function modalCell(membreId, date) {
    const f = ferieNom(date);
    if (f) { toast("Jour férié (" + f + ") — cabinet fermé, aucune planification."); return; }
    const fm = fermetureFor(date);
    if (fm) { toast("Fermeture du cabinet (" + fm.nom + ") — aucune planification."); return; }
    const existing = state.planning.find(p => p.membreId === membreId && p.date === date);
    const e = existing || { type: "present", note: "" };
    const typeOpts = Object.keys(PLANNING_TYPES).map(k => ({ v: k, l: PLANNING_TYPES[k].ico + " " + PLANNING_TYPES[k].label }));
    let slots = creneauxOf(e);
    if (!slots.length) slots = [{ debut: "09:00", fin: "18:00" }];
    const body = `
      <p class="pc-meta" style="margin-bottom:12px">${esc(membreNom(membreId))} — ${fmtDate(date)}</p>
      ${fSelect("type", "Statut", e.type, typeOpts)}
      <div id="creneaux-block">
        <label style="display:block;font-size:.85rem;font-weight:600;margin-bottom:6px">Créneaux horaires</label>
        <div id="creneaux-list"></div>
        <button type="button" class="btn-line" id="add-creneau" style="margin-top:2px">＋ Ajouter un créneau</button>
      </div>
      ${fText("note", "Note", e.note)}
    `;
    const ov = openModal("Planning", body, (ov) => {
      const type = val(ov, "type");
      const creneaux = [];
      if (type === "present") {
        ov.querySelectorAll(".creneau-row").forEach(row => {
          const debut = row.querySelector(".cr-debut").value;
          const fin = row.querySelector(".cr-fin").value;
          if (debut && fin) creneaux.push({ debut, fin });
        });
        if (!creneaux.length) { toast("Ajoutez au moins un créneau horaire."); return false; }
        creneaux.sort((a, b) => a.debut.localeCompare(b.debut));
      }
      const data = { membreId, date, type, creneaux, debut: "", fin: "", note: val(ov, "note") };
      if (existing) Object.assign(existing, data); else state.planning.push({ id: uid(), ...data });
      save(); renderTab();
    });

    // Éditeur de créneaux dynamique (helper partagé)
    slotEditor(ov.querySelector("#creneaux-list"), ov.querySelector("#add-creneau"), slots);

    // bouton supprimer si existant
    if (existing) {
      const foot = ov.querySelector(".modal-foot");
      const del = document.createElement("button");
      del.className = "btn btn-soft"; del.textContent = "Effacer"; del.style.flex = "0 0 auto";
      del.onclick = () => { state.planning = state.planning.filter(p => p !== existing); save(); renderTab(); modalRoot.innerHTML = ""; };
      foot.insertBefore(del, foot.firstChild);
    }
    const toggle = () => { ov.querySelector("#creneaux-block").style.display = ov.querySelector("[name=type]").value === "present" ? "block" : "none"; };
    ov.querySelector("[name=type]").onchange = toggle; toggle();
  }

  /* ---- Éditeur de créneaux réutilisable ---- */
  function slotEditor(listEl, addBtn, initialSlots) {
    const rowHTML = (c) => `<div class="creneau-row">
      <input type="time" class="cr-debut" value="${esc(c.debut || "")}">
      <span class="cr-sep">→</span>
      <input type="time" class="cr-fin" value="${esc(c.fin || "")}">
      <button type="button" class="cr-del" title="Supprimer ce créneau">🗑</button>
    </div>`;
    const wireDel = (row) => {
      row.querySelector(".cr-del").onclick = () => {
        if (listEl.querySelectorAll(".creneau-row").length <= 1) { toast("Il faut au moins un créneau."); return; }
        row.remove();
      };
    };
    const slots = (initialSlots && initialSlots.length) ? initialSlots : [{ debut: "09:00", fin: "18:00" }];
    listEl.innerHTML = slots.map(rowHTML).join("");
    listEl.querySelectorAll(".creneau-row").forEach(wireDel);
    addBtn.onclick = () => {
      const div = document.createElement("div"); div.innerHTML = rowHTML({ debut: "14:00", fin: "18:00" });
      const row = div.firstElementChild; listEl.appendChild(row); wireDel(row);
    };
    return () => Array.from(listEl.querySelectorAll(".creneau-row"))
      .map(r => ({ debut: r.querySelector(".cr-debut").value, fin: r.querySelector(".cr-fin").value }))
      .filter(c => c.debut && c.fin).sort((a, b) => a.debut.localeCompare(b.debut));
  }

  /* ---- Remplissage d'horaires sur une période ---- */
  function appliquerHoraires(membreIds, du, au, jours, creneaux, overwrite) {
    let count = 0, cur = du, guard = 0;
    while (cur <= au && guard++ < 4000) {
      const wd = (new Date(cur + "T00:00:00").getDay() + 6) % 7; // 0 = lundi
      if (jours.includes(wd) && !ferieNom(cur) && !fermetureFor(cur)) { // saute fériés et fermetures
        membreIds.forEach(mid => {
          const ex = state.planning.find(p => p.membreId === mid && p.date === cur);
          if (!ex) { state.planning.push({ id: uid(), membreId: mid, date: cur, type: "present", creneaux: creneaux.map(c => ({ ...c })), debut: "", fin: "", note: "" }); count++; }
          else if (overwrite) { ex.type = "present"; ex.creneaux = creneaux.map(c => ({ ...c })); ex.debut = ""; ex.fin = ""; count++; }
        });
      }
      cur = isoAdd(cur, 1);
    }
    return count;
  }

  /* ---- Modale : horaires par défaut & paramètres ---- */
  function modalParametres() {
    const r = state.reglages;
    const jourLabels = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
    const body = `
      <div class="tab-section-label" style="margin-top:0">Affichage</div>
      <label class="chk-line"><input type="checkbox" name="weekend" ${r.afficherWeekend ? "checked" : ""}> Afficher le samedi et le dimanche dans le planning</label>

      <div class="tab-section-label" style="margin-top:18px">Créneaux horaires par défaut</div>
      <p class="pc-meta" style="margin:-6px 0 8px">Servent au remplissage ci-dessous et pré-remplissent les nouvelles journées.</p>
      <div id="def-list"></div>
      <button type="button" class="btn-line" id="def-add" style="margin-bottom:2px">＋ Ajouter un créneau</button>

      <div class="tab-section-label" style="margin-top:18px">Appliquer sur une période</div>
      <div class="field"><label>Membre</label>
        <select name="cible">
          <option value="__all__">Tous les membres actifs</option>
          ${state.membres.filter(m => m.actif).map(m => `<option value="${m.id}">${esc(m.prenom)} ${esc(m.nom)}</option>`).join("")}
        </select></div>
      <div class="field-row">${fText("periodeDu", "Du", "", { type: "date" })}${fText("periodeAu", "Au", "", { type: "date" })}</div>
      <label style="display:block;font-size:.85rem;font-weight:600;margin-bottom:6px">Jours concernés</label>
      <div class="jours-chk">
        ${jourLabels.map((j, idx) => `<label class="chk-inline"><input type="checkbox" class="jour-chk" value="${idx}" ${idx < 5 ? "checked" : ""}> ${j}</label>`).join("")}
      </div>
      <label class="chk-line" style="margin-top:10px"><input type="checkbox" name="overwrite"> Remplacer les journées déjà renseignées</label>
      <button type="button" class="btn btn-primary" id="apply-periode" style="width:100%;justify-content:center;margin-top:12px">📅 Appliquer les horaires sur la période</button>
    `;
    const ov = openModal("Horaires par défaut & paramètres", body, (ov) => {
      state.reglages.afficherWeekend = ov.querySelector("[name=weekend]").checked;
      const def = getDef(); if (def.length) state.reglages.creneauxDefaut = def;
      save(); render();
    }, "Enregistrer les paramètres");

    const getDef = slotEditor(ov.querySelector("#def-list"), ov.querySelector("#def-add"), (r.creneauxDefaut || []).map(c => ({ ...c })));

    ov.querySelector("#apply-periode").onclick = () => {
      const du = ov.querySelector("[name=periodeDu]").value, au = ov.querySelector("[name=periodeAu]").value;
      if (!du || !au) { toast("Choisissez une date de début et de fin."); return; }
      if (au < du) { toast("La date de fin précède le début."); return; }
      const jours = Array.from(ov.querySelectorAll(".jour-chk:checked")).map(c => Number(c.value));
      if (!jours.length) { toast("Sélectionnez au moins un jour."); return; }
      const creneaux = getDef();
      if (!creneaux.length) { toast("Définissez au moins un créneau par défaut."); return; }
      state.reglages.afficherWeekend = ov.querySelector("[name=weekend]").checked;
      state.reglages.creneauxDefaut = creneaux;
      const cible = ov.querySelector("[name=cible]").value;
      const ids = cible === "__all__" ? state.membres.filter(m => m.actif).map(m => m.id) : [cible];
      const n = appliquerHoraires(ids, du, au, jours, creneaux, ov.querySelector("[name=overwrite]").checked);
      save(); modalRoot.innerHTML = ""; view.tab = "planning"; render();
      toast(n + " créneau" + (n > 1 ? "x" : "") + " de journée appliqué" + (n > 1 ? "s" : "") + ".");
    };
  }

  /* ---- Modale : fermetures du cabinet ---- */
  function modalFermetures() {
    const ferm = (state.fermetures || []).slice().sort((a, b) => a.du.localeCompare(b.du));
    const salaries = state.membres.filter(m => m.actif && m.salarie).length;
    const list = ferm.length ? ferm.map(f => {
      const jours = fermetureJoursOuvres(f);
      return `<div class="plain-card"><div class="pc-icon amber">🔒</div>
        <div class="pc-body"><div class="pc-title">${esc(f.nom)}</div>
        <div class="pc-meta">${fmtDate(f.du)} → ${fmtDate(f.au)} · ${jours} j ouvré${jours > 1 ? "s" : ""}${salaries ? " · congés décomptés" : ""}</div></div>
        <button class="icon-btn del" data-del-fermeture="${f.id}" title="Supprimer">🗑</button></div>`;
    }).join("") : `<p class="pc-meta">Aucune fermeture enregistrée.</p>`;

    const body = `
      <p class="pc-meta" style="margin-bottom:14px">Pendant une fermeture, le cabinet est fermé pour tout le monde. Les <strong>salarié·es</strong> sont automatiquement mis·es en <strong>congés</strong> (jours ouvrés décomptés du solde) ; les jours fériés inclus ne sont pas décomptés.</p>
      <div class="tab-section-label" style="margin-top:0">Fermetures enregistrées</div>
      ${list}
      <div class="tab-section-label" style="margin-top:18px">Ajouter une fermeture</div>
      ${fText("nom", "Intitulé", "", { ph: "Fermeture estivale, Congés de Noël…" })}
      <div class="field-row">${fText("du", "Du", "", { type: "date" })}${fText("au", "Au", "", { type: "date" })}</div>
      <button type="button" class="btn btn-primary" id="add-fermeture" style="width:100%;justify-content:center;margin-top:4px">🔒 Ajouter la fermeture</button>
    `;
    const ov = openModal("Fermetures du cabinet", body, () => {}, "Fermer");
    // masque le bouton "Annuler" (la modale est un gestionnaire, pas un formulaire unique)
    const cancel = ov.querySelector("[data-cancel]"); if (cancel) cancel.style.display = "none";

    ov.querySelector("#add-fermeture").onclick = () => {
      const nom = ov.querySelector("[name=nom]").value.trim() || "Fermeture";
      const du = ov.querySelector("[name=du]").value, au = ov.querySelector("[name=au]").value;
      if (!du || !au) { toast("Choisissez les dates de début et de fin."); return; }
      if (au < du) { toast("La date de fin précède le début."); return; }
      state.fermetures.push({ id: uid(), nom, du, au });
      save(); modalRoot.innerHTML = ""; view.tab = "planning"; render();
      toast("Fermeture « " + nom + " » ajoutée.");
    };
  }
  function fermetureJoursOuvres(f) {
    let n = 0, cur = f.du, guard = 0;
    while (cur <= f.au && guard++ < 800) {
      const wd = new Date(cur + "T00:00:00").getDay();
      if (wd !== 0 && wd !== 6 && !ferieNom(cur)) n++;
      cur = isoAdd(cur, 1);
    }
    return n;
  }

  function modalDemande() {
    const opts = state.membres.filter(m => m.actif).map(m => ({ v: m.id, l: m.prenom + " " + m.nom }));
    const today = iso(new Date());
    const body = `
      ${fSelect("membreId", "Membre", opts[0] && opts[0].v, opts)}
      ${fSelect("type", "Type", "Congé payé", ABSENCE_TYPES)}
      <div class="field-row">${fText("dateDebut", "Du", today, { type: "date" })}${fText("dateFin", "Au", today, { type: "date" })}</div>
      ${fText("motif", "Motif (optionnel)", "")}
    `;
    openModal("Nouvelle demande", body, (ov) => {
      const dd = val(ov, "dateDebut"), df = val(ov, "dateFin");
      if (!dd || !df) { toast("Dates obligatoires."); return false; }
      if (df < dd) { toast("La date de fin précède le début."); return false; }
      state.demandes.push({ id: uid(), membreId: val(ov, "membreId"), type: val(ov, "type"), dateDebut: dd, dateFin: df, motif: val(ov, "motif"), statut: "en_attente", createdAt: new Date().toISOString() });
      save(); render();
    }, "Envoyer la demande");
  }

  /* ---- Validation / refus d'une demande ---- */
  function traiterDemande(id, statut) {
    const d = state.demandes.find(x => x.id === id); if (!d) return;
    d.statut = statut;
    if (statut === "valide" && /Cong|RTT|Absence|Maladie|Formation/.test(d.type)) {
      // reporte sur le planning
      const typeMap = { "Congé payé": "conge", "RTT": "conge", "Absence": "absence", "Maladie": "maladie", "Formation": "formation" };
      const pt = typeMap[d.type] || "absence";
      let cur = d.dateDebut, guard = 0;
      while (cur <= d.dateFin && guard++ < 400) {
        const wd = new Date(cur + "T00:00:00").getDay();
        if (wd !== 0 && wd !== 6) {
          const ex = state.planning.find(p => p.membreId === d.membreId && p.date === cur);
          if (ex) { ex.type = pt; ex.debut = ""; ex.fin = ""; ex.creneaux = []; }
          else state.planning.push({ id: uid(), membreId: d.membreId, date: cur, type: pt, debut: "", fin: "", creneaux: [], note: d.type });
        }
        cur = isoAdd(cur, 1);
      }
    }
    save(); render();
    toast(statut === "valide" ? "Demande validée." : "Demande refusée.");
  }

  /* =========================================================
     ÉVÉNEMENTS (délégation, scopée au module Personnel)
     ========================================================= */
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#app-personnel") && !e.target.closest("#modal-root")) return;
    const t = e.target.closest("[data-ptab],[data-pact],[data-pcell],[data-pferie],[data-pferm],[data-pbadge],[data-edit-membre],[data-del-membre],[data-compte-membre],[data-del-fermeture],[data-valide],[data-refuse],[data-del-demande]");
    if (!t) return;

    if (t.dataset.ptab) { view.tab = t.dataset.ptab; return render(); }
    if (t.dataset.pferie) { toast("Jour férié (" + t.dataset.pferie + ") — cabinet fermé."); return; }
    if (t.dataset.pferm) { toast("Fermeture du cabinet : " + t.dataset.pferm + "."); return; }
    if (t.dataset.pcell) { const [mid, date] = t.dataset.pcell.split("|"); return modalCell(mid, date); }
    if (t.dataset.pbadge) { const m = membre(t.dataset.pbadge); if (m) pointer(m); return; }
    if (t.dataset.editMembre) return modalMembre(membre(t.dataset.editMembre));
    if (t.dataset.compteMembre) return modalCompte(membre(t.dataset.compteMembre));
    if (t.dataset.delMembre) { if (confirm("Supprimer ce membre ? Son historique de pointages restera mais ne sera plus associé.")) { state.membres = state.membres.filter(x => x.id !== t.dataset.delMembre); save(); renderTab(); } return; }
    if (t.dataset.delFermeture) { if (confirm("Supprimer cette fermeture ?")) { state.fermetures = state.fermetures.filter(x => x.id !== t.dataset.delFermeture); save(); render(); modalFermetures(); } return; }
    if (t.dataset.valide) {
      if (!sessionUser || !sessionUser.isManager) { toast("Seul l'employeur peut valider une demande."); return; }
      return traiterDemande(t.dataset.valide, "valide");
    }
    if (t.dataset.refuse) {
      if (!sessionUser || !sessionUser.isManager) { toast("Seul l'employeur peut refuser une demande."); return; }
      return traiterDemande(t.dataset.refuse, "refuse");
    }
    if (t.dataset.delDemande) {
      const d = state.demandes.find(x => x.id === t.dataset.delDemande);
      if (!d || !sessionUser) return;
      if (!sessionUser.isManager && (d.membreId !== sessionUser.id || d.statut !== "en_attente")) {
        toast("Vous ne pouvez annuler que vos propres demandes en attente."); return;
      }
      if (confirm("Supprimer cette demande ?")) { state.demandes = state.demandes.filter(x => x.id !== t.dataset.delDemande); save(); render(); }
      return;
    }

    switch (t.dataset.pact) {
      case "week-prev": view.weekStart = isoAdd(view.weekStart, -7); return renderTab();
      case "week-next": view.weekStart = isoAdd(view.weekStart, 7); return renderTab();
      case "week-today": view.weekStart = mondayOf(new Date()); return renderTab();
      case "month-prev": view.monthRef = shiftMonth(view.monthRef, -1); return renderTab();
      case "month-next": view.monthRef = shiftMonth(view.monthRef, 1); return renderTab();
      case "logout": sessionUser = null; render(); return;
      case "print-planning": window.print(); return;
      case "params-planning": return modalParametres();
      case "fermetures": return modalFermetures();
      case "export-paie": return exportPaie();
      case "add-membre": return modalMembre(null);
      case "add-demande": return modalDemande();
      case "goto-badgeuse": view.tab = "badgeuse"; return render();
    }
  });
  function shiftMonth(ym, delta) { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + delta, 1); return ymOf(d); }

  /* =========================================================
     ENREGISTREMENT DANS LE SHELL
     ========================================================= */
  if (window.CybeleShell) {
    window.CybeleShell.register("personnel", {
      label: "Personnel",
      getState: () => state,
      setState: (s) => {
        if (!s || !Array.isArray(s.membres)) return false;
        state = migrate(s); save(); view.tab = "dashboard"; render(); return true;
      },
      onShow: () => render(),
    });
  }

  // Chargement initial depuis Firestore puis rendu
  async function initPersonnel() {
    // Attendre la connexion (sécurité) avant tout accès aux données cloud
    if (window.CybeleAuth) { try { await window.CybeleAuth.whenReady(); } catch (e) {} }
    if (window.CybeleDB) {
      try {
        const cloud = await Promise.race([
          window.CybeleDB.load("personnel"),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 6000))
        ]);
        if (cloud) {
          state = migrate(cloud);
          try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
        } else {
          state = loadLocal() || seed();
          if (!loadLocal()) save();
        }
      } catch (e) {
        state = loadLocal() || seed();
      }
    } else {
      state = loadLocal() || seed();
    }
    autoSelectSession();
    if (document.body.dataset.module === "personnel") render();
  }
  initPersonnel();
})();
