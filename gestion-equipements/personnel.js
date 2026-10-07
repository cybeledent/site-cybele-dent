/* =========================================================
   CybèleGestion — Module Personnel / RH
   Planning partagé, suivi privé (employeur), demandes de congés,
   résumé pour le comptable.
   Données : localStorage + Firestore (clé cybele-personnel-v1,
   suivi privé dans cybele-personnel-prive-v1).
   ========================================================= */
(function () {
  "use strict";

  const STORE_KEY = "cybele-personnel-v1";
  const PRIVE_KEY = "cybele-personnel-prive-v1";

  const ROLES = ["Praticien", "Assistant(e)", "Secrétaire", "Autre"];
  // Types proposés dans les demandes (visibles de tous)
  const ABSENCE_TYPES = ["Congé payé", "RTT", "Congé sans solde", "Absence", "Maladie", "Formation"];
  // Types d'absence du suivi privé (employeur) — ce qui figurera dans le résumé comptable
  const SUIVI_ABSENCES = ["Congé payé", "Congé sans solde", "Absence injustifiée", "Maladie (arrêt)", "RTT", "Formation", "Événement familial", "Autre"];
  const DUREES = { journee: "journée", matin: "matin", apresmidi: "après-midi" };

  const PLANNING_TYPES = {
    present:   { label: "Présent",     cls: "present",   ico: "🟢" },
    repos:     { label: "Repos",       cls: "repos",     ico: "⚪" },
    conge:     { label: "Congé",       cls: "conge",     ico: "🌴" },
    conge_ss:  { label: "Sans solde",  cls: "conge-ss",  ico: "🌙" },
    absence:   { label: "Absence",     cls: "absence",   ico: "🟠" },
    maladie:   { label: "Maladie",     cls: "maladie",   ico: "🔴" },
    formation: { label: "Formation",   cls: "formation", ico: "🎓" },
  };
  const COLORS = ["#e07a5f", "#3a6ea5", "#16a36a", "#9b5de5", "#c98a14", "#d6453f", "#0ca5a5"];
  const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const JOURS_1 = ["L", "M", "M", "J", "V", "S", "D"];
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
  let state = null;   // données partagées (membres, planning, demandes…)
  let prive = null;   // suivi privé de l'employeur (retards, heures sup, absences)
  let sessionUser = null; // membre connecté pour cette session
  let view = { tab: "dashboard", weekStart: mondayOf(new Date()), monthRef: ymOf(new Date()), resumeDu: "", resumeAu: "", resumeMembre: "", bilanOffset: 0 };

  function loadLocal() {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) {}
    return null;
  }
  function migrate(s) {
    s.membres = s.membres || []; s.planning = s.planning || [];
    s.demandes = s.demandes || []; s.reglages = s.reglages || defaultReglages();
    s.fermetures = s.fermetures || [];
    delete s.pointages; // ancienne badgeuse — plus utilisée
    // Chaque membre est salarié·e par défaut (sauf praticien) → congés décomptés lors des fermetures
    s.membres.forEach(m => {
      if (m.salarie === undefined) m.salarie = m.role !== "Praticien";
      if (m.login === undefined) m.login = ""; // identifiant du compte de connexion associé
      if (m.dateEntree === undefined) m.dateEntree = "";   // date d'entrée (acquisition des congés au prorata)
      if (m.reportConges === undefined) m.reportConges = 0; // jours reportés de la période précédente
    });
    // Complète les réglages manquants (rétro-compat)
    if (s.reglages.afficherWeekend === undefined) s.reglages.afficherWeekend = false;
    if (!s.reglages.modeConges) s.reglages.modeConges = "mensuel";       // "mensuel" (1/12 par mois) ou "fixe"
    if (!s.reglages.uniteConges) {
      // Première ouverture avec le décompte en jours ouvrables : on aligne sur les contrats
      // (30 jours ouvrables, période légale du 1er juin au 31 mai). Les fiches encore au
      // défaut « 25 jours ouvrés » passent à 30 ; les autres valeurs sont conservées.
      s.reglages.uniteConges = "ouvrables";   // "ouvrables" (lundi–samedi, 30 j/an) ou "ouvres" (lundi–vendredi, 25 j/an)
      s.reglages.periodeRefMois = 6;
      s.reglages.congesAnnuelDefaut = 30;
      s.membres.forEach(m => { if (Number(m.congesAcquis) === 25) m.congesAcquis = 30; });
    }
    if (!s.reglages.periodeRefMois) s.reglages.periodeRefMois = 6;       // mois de début de la période de référence (1 = janvier, 6 = juin)
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
  function defaultReglages() { return { heuresSemaineDefaut: 35, congesAnnuelDefaut: 30, pauseDejeunerMin: 60, afficherWeekend: false, creneauxDefaut: [{ debut: "09:00", fin: "13:00" }, { debut: "14:00", fin: "18:00" }], modeConges: "mensuel", uniteConges: "ouvrables", periodeRefMois: 6 }; }
  // Unité de décompte des congés payés
  function enOuvrables() { return (state.reglages.uniteConges || "ouvrables") !== "ouvres"; }
  function uniteLabel() { return enOuvrables() ? "ouvrables" : "ouvrés"; }
  function fmtCP(n) { // "6 jours ouvrables", "1 jour ouvrable", "½ journée"
    if (n < 1) return fmtJours(n);
    const u = uniteLabel();
    return fmtJours(n) + " " + (n > 1 ? u : (u === "ouvrables" ? "ouvrable" : "ouvré"));
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast("⚠ Mémoire pleine."); }
    if (window.CybeleDB) window.CybeleDB.save("personnel", state).catch(() => {});
  }

  /* ---- Suivi privé ---- */
  function migratePrive(p) {
    p = p || {};
    p.suivi = Array.isArray(p.suivi) ? p.suivi : [];
    p.suivi.forEach(s => {
      s.retardMin = Number(s.retardMin) || 0;
      s.supMin = Number(s.supMin) || 0;
      s.absence = s.absence || "";
      s.duree = s.duree || "journee";
      s.note = s.note || "";
    });
    return p;
  }
  function loadPriveLocal() {
    try { const raw = localStorage.getItem(PRIVE_KEY); if (raw) return migratePrive(JSON.parse(raw)); } catch (e) {}
    return null;
  }
  function savePrive() {
    try { localStorage.setItem(PRIVE_KEY, JSON.stringify(prive)); } catch (e) {}
    if (window.CybeleDB) window.CybeleDB.save("personnel-prive", prive).catch(() => {});
  }
  function suiviOf(membreId, date) { return prive.suivi.find(s => s.membreId === membreId && s.date === date); }
  function suiviVide(s) { return !s.retardMin && !s.supMin && !s.absence && !s.note; }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* =========================================================
     DONNÉES D'EXEMPLE
     ========================================================= */
  function seed() {
    const m1 = uid(), m2 = uid(), m3 = uid(), m4 = uid(), m5 = uid();
    const mon = mondayOf(new Date());
    const dd = (i) => isoAdd(mon, i);
    const mk = (id, prenom, nom, role, binomeId, couleur, pin, h) =>
      ({ id, prenom, nom, role, binomeId, couleur, pin, heuresSemaine: h, congesAcquis: 30, actif: true, salarie: role !== "Praticien" });

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
        if (mb.id === m4 && i === 2) { planning.push({ id: uid(), membreId: mb.id, date: dd(i), type: "formation", debut: "", fin: "", creneaux: [], note: "Formation implanto" }); continue; }
        const c = mb.id === m5 ? [{ debut: "08:30", fin: "16:30" }] : [{ debut: "09:00", fin: "13:00" }, { debut: "14:00", fin: "18:00" }];
        planning.push({ id: uid(), membreId: mb.id, date: dd(i), type: "present", debut: "", fin: "", creneaux: c, note: "" });
      }
    });

    const demandes = [
      { id: uid(), membreId: m3, type: "Congé payé", dateDebut: dd(12), dateFin: dd(16), motif: "Vacances", statut: "en_attente", createdAt: new Date().toISOString() },
      { id: uid(), membreId: m5, type: "RTT", dateDebut: dd(8), dateFin: dd(8), motif: "", statut: "en_attente", createdAt: new Date().toISOString() },
    ];

    const yr = new Date().getFullYear();
    const fermetures = [{ id: uid(), nom: "Fermeture estivale", du: yr + "-08-03", au: yr + "-08-14" }];

    return migrate({ membres, planning, demandes, fermetures, reglages: defaultReglages() });
  }

  /* =========================================================
     UTILITAIRES DATE / HEURE
     ========================================================= */
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
  function weekdayOf(isoStr) { return (new Date(isoStr + "T00:00:00").getDay() + 6) % 7; } // 0 = lundi … 6 = dimanche
  function isWeekend(isoStr) { return weekdayOf(isoStr) >= 5; }
  function monthBounds(ym) { const [y, mo] = ym.split("-").map(Number); return { from: ym + "-01", to: iso(new Date(y, mo, 0)) }; }
  function shiftMonth(ym, delta) { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + delta, 1); return ymOf(d); }
  function fmtDate(isoStr) {
    if (!isoStr) return "—";
    const d = new Date(isoStr + "T00:00:00");
    if (isNaN(d)) return isoStr;
    return d.getDate() + " " + MOIS_C[d.getMonth()] + " " + d.getFullYear();
  }
  function fmtDateShort(isoStr) { const d = new Date(isoStr + "T00:00:00"); return d.getDate() + " " + MOIS_C[d.getMonth()]; }
  function fmtLong(isoStr) { const d = new Date(isoStr + "T00:00:00"); return (d.getDate() === 1 ? "1er" : d.getDate()) + " " + MOIS[d.getMonth()] + " " + d.getFullYear(); }
  function fmtPeriode(a, b) { // "du 6 au 10 octobre 2026" / "du 29 septembre au 3 octobre 2026"
    if (a === b) return "le " + fmtLong(a);
    const da = new Date(a + "T00:00:00"), db = new Date(b + "T00:00:00");
    const ja = da.getDate() === 1 ? "1er" : da.getDate();
    if (da.getMonth() === db.getMonth() && da.getFullYear() === db.getFullYear()) return "du " + ja + " au " + fmtLong(b);
    if (da.getFullYear() === db.getFullYear()) return "du " + ja + " " + MOIS[da.getMonth()] + " au " + fmtLong(b);
    return "du " + fmtLong(a) + " au " + fmtLong(b);
  }
  function parseHM(s) { if (!s) return null; const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); }
  function fmtHM(min) { if (min == null) return "—"; const h = Math.floor(Math.abs(min) / 60), m = Math.round(Math.abs(min) % 60); return (min < 0 ? "-" : "") + h + "h" + (m ? String(m).padStart(2, "0") : ""); }
  // "1h30" / "1 h 30" / "1:30" / "45" / "45 min" / "0,5 h" → minutes (0 si vide, null si incompréhensible)
  function parseDuree(s) {
    s = String(s || "").trim().toLowerCase().replace(",", ".");
    if (!s) return 0;
    let m = s.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d{1,2}))?\s*(?:min)?$/);
    if (m) return Math.round(parseFloat(m[1]) * 60 + (parseInt(m[2] || "0", 10)));
    m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    m = s.match(/^(\d+)\s*(?:min|mn|minutes?)?$/);
    if (m) return parseInt(m[1], 10);
    return null;
  }
  function fmtDuree(min) { // "20 min" / "1h30" / "2h"
    min = Math.round(min || 0);
    if (min < 60) return min + " min";
    return fmtHM(min);
  }
  function fmtJours(n) { // 0.5 → "½ journée", 1 → "1 jour", 2.5 → "2,5 jours"
    if (n === 0.5) return "½ journée";
    const s = String(n).replace(".", ",");
    return s + (n > 1 ? " jours" : " jour");
  }
  function workdaysBetween(a, b) { // jours ouvrés Lun-Ven inclus
    let n = 0, d = new Date(a + "T00:00:00"), end = new Date(b + "T00:00:00");
    while (d <= end) { const wd = d.getDay(); if (wd !== 0 && wd !== 6) n++; d.setDate(d.getDate() + 1); }
    return n;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  // Minuscule initiale ("Congé payé" → "congé payé") sauf pour les sigles ("RTT")
  function lc1(s) { s = String(s || ""); return /^[A-ZÀ-Ý][a-zà-ÿ]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

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
  // Jour "ouvrable" pour le cabinet : ni week-end, ni férié
  function isOuvre(isoStr) { return !isWeekend(isoStr) && !ferieNom(isoStr); }

  function membre(id) { return state.membres.find(m => m.id === id); }
  function membreNom(id) { const m = membre(id); return m ? m.prenom + " " + m.nom : "—"; }
  function initiales(m) { return (m.prenom[0] || "") + (m.nom[0] || ""); }
  function isManager() { return !!(sessionUser && sessionUser.isManager); }
  function membresActifs() { return state.membres.filter(m => m.actif); }
  function membresTries() { return membresActifs().slice().sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom, "fr")); }

  /* ---- Calculs heures (planning) ---- */
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
  /* ---- Congés payés : période de référence, acquisition, solde ---- */
  function addMonths(isoStr, n) { const d = new Date(isoStr + "T00:00:00"); d.setMonth(d.getMonth() + n); return iso(d); }
  function round1(n) { return Math.round(n * 10) / 10; }
  function fmtNum(n) { return String(round1(n)).replace(".", ","); }
  // Période de référence des congés contenant `dateIso` (décalée de `offset` périodes)
  function periodeRef(dateIso, offset) {
    const mo = Number(state.reglages.periodeRefMois) || 1;
    const d = new Date(dateIso + "T00:00:00");
    let y = d.getFullYear(); if ((d.getMonth() + 1) < mo) y--;
    y += (offset || 0);
    const from = y + "-" + pad2(mo) + "-01";
    const to = isoAdd(addMonths(from, 12), -1);
    const label = mo === 1 ? String(y) : (y + "-" + (y + 1));
    const detail = mo === 1 ? "année civile " + y : "du 1er " + MOIS[mo - 1] + " " + y + " au " + fmtLong(to);
    return { from, to, label, detail, annee: y };
  }
  // Congés payés pris sur une période (dans l'unité choisie, demi-journées comprises) :
  // suivi privé + congés validés du planning + fermetures du cabinet, sans doublon
  function congesPrisPeriode(m, from, to) {
    return absencesPour(m, from, to).runs.filter(r => /^Congé payé/.test(r.label)).reduce((s, r) => s + r.cout, 0);
  }
  // Jour ouvrable : ni dimanche, ni férié (le samedi compte)
  function isOuvrable(isoStr) { return weekdayOf(isoStr) !== 6 && !ferieNom(isoStr); }
  // Jour où la personne aurait travaillé : jour ouvré du cabinet, non marqué « Repos » dans son planning
  function jourTravaille(m, isoStr) {
    if (!isOuvre(isoStr)) return false;
    const p = state.planning.find(x => x.membreId === m.id && x.date === isoStr);
    return !(p && p.type === "repos");
  }
  // Coût d'un épisode de congé payé en jours ouvrables : du premier jour d'absence
  // jusqu'au dernier jour ouvrable précédant la reprise (règle légale, samedi compris)
  function coutOuvrables(m, from, to) {
    let reprise = isoAdd(to, 1), guard = 0;
    while (!jourTravaille(m, reprise) && guard++ < 31) reprise = isoAdd(reprise, 1);
    let n = 0;
    for (let d = from; d < reprise; d = isoAdd(d, 1)) if (isOuvrable(d)) n++;
    return n;
  }
  // Acquisition : 1/12 du droit annuel par mois complet de présence depuis le début
  // de la période (ou la date d'entrée), jusqu'à `asOf` ; mode "fixe" = droit annuel entier
  function acquisConges(m, per, asOf) {
    const annuel = Number(m.congesAcquis) || 0, report = Number(m.reportConges) || 0;
    if (state.reglages.modeConges === "fixe") return { mode: "fixe", acquis: annuel, fin: annuel, report, total: annuel + report, mois: 12, moisFin: 12, depuis: per.from };
    const start = (m.dateEntree && m.dateEntree > per.from) ? m.dateEntree : per.from;
    const limit = asOf < per.to ? asOf : per.to;
    let mois = 0, moisFin = 0;
    while (mois < 12 && addMonths(start, mois + 1) <= isoAdd(limit, 1)) mois++;
    while (moisFin < 12 && addMonths(start, moisFin + 1) <= isoAdd(per.to, 1)) moisFin++;
    const taux = annuel / 12;
    return { mode: "mensuel", acquis: round1(mois * taux), fin: round1(moisFin * taux), report, total: round1(mois * taux + report), mois, moisFin, depuis: start, taux };
  }
  // Situation des congés payés d'une personne sur la période de référence courante
  function situationConges(m, offset) {
    const today = iso(new Date());
    const per = periodeRef(today, offset);
    const acq = acquisConges(m, per, today);
    const pris = congesPrisPeriode(m, per.from, per.to);
    return { per, acq, pris, solde: round1(acq.total - pris), soldeFin: round1(acq.fin + acq.report - pris) };
  }

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
  function fText(n, l, v, o) { o = o || {}; return `<div class="field"><label>${esc(l)}</label><input type="${o.type || "text"}" name="${n}" value="${esc(v || "")}" placeholder="${esc(o.ph || "")}"${o.attrs || ""}></div>`; }
  function fSelect(n, l, v, opts) { return `<div class="field"><label>${esc(l)}</label><select name="${n}">${opts.map(o => { const val = typeof o === "string" ? o : o.v, lab = typeof o === "string" ? o : o.l; return `<option value="${esc(val)}" ${val === v ? "selected" : ""}>${esc(lab)}</option>`; }).join("")}</select></div>`; }

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
    // Les onglets privés ne sont accessibles qu'à l'employeur
    if ((view.tab === "suivi" || view.tab === "resume" || view.tab === "bilan") && !isManager()) view.tab = "dashboard";
    root.innerHTML = `
      <div class="session-bar">
        <span>👤 ${esc(sessionUser.prenom)} ${esc(sessionUser.nom)}${sessionUser.isManager ? " · <strong>Employeur</strong>" : ""}</span>
        <button class="btn-ghost-sm" data-pact="logout">Déconnecter</button>
      </div>
      <div class="p-subnav">
        ${subTab("dashboard", "📊 Tableau de bord")}
        ${subTab("planning", "🗓 Planning")}
        ${isManager() ? subTab("suivi", "🔒 Suivi privé") : ""}
        ${isManager() ? subTab("resume", "🧾 Résumé comptable") : ""}
        ${isManager() ? subTab("bilan", "📅 Bilan annuel") : ""}
        ${subTab("demandes", "✅ Demandes")}
        ${subTab("membres", "👤 Membres")}
      </div>
      <div id="p-content"></div>`;
    renderTab();
    window.scrollTo(0, 0);
  }

  function renderLogin() {
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
    if (!c) return;
    if (view.tab === "dashboard") c.innerHTML = viewDashboard();
    else if (view.tab === "planning") c.innerHTML = viewPlanning();
    else if (view.tab === "suivi") c.innerHTML = viewSuivi();
    else if (view.tab === "resume") c.innerHTML = viewResume();
    else if (view.tab === "bilan") c.innerHTML = viewBilan();
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
    const ferie = ferieNom(today), ferm = fermetureFor(today);
    // Absent·es aujourd'hui d'après le planning partagé
    const absents = membresActifs().map(m => {
      const e = state.planning.find(p => p.membreId === m.id && p.date === today);
      return e && e.type !== "present" && e.type !== "repos" ? { m, e } : null;
    }).filter(Boolean);
    const presents = ferie || ferm ? [] : membresActifs().filter(m => state.planning.some(p => p.membreId === m.id && p.date === today && p.type === "present"));

    const stat = (n, label, cls) => `<div class="p-stat ${cls || ""}"><div class="p-stat-n">${n}</div><div class="p-stat-l">${label}</div></div>`;
    const mgr = isManager();
    let mgrStats = "";
    if (mgr) {
      const { from, to } = monthBounds(ymOf(new Date()));
      const mois = prive.suivi.filter(s => s.date >= from && s.date <= to);
      const retards = mois.filter(s => s.retardMin > 0).length;
      const sup = mois.reduce((t, s) => t + (s.supMin || 0), 0);
      mgrStats = stat(retards, "Retards ce mois", retards ? "warn" : "") + stat(fmtHM(sup), "Heures sup. ce mois", sup ? "ok" : "");
    }

    return `
      <div class="p-stats ${mgr ? "p-stats-5" : ""}">
        ${stat(membresActifs().length, "Membres actifs")}
        ${stat(presents.length, "Prévu·es aujourd'hui", "ok")}
        ${stat(enAttente.length, "Demandes en attente", enAttente.length ? "warn" : "")}
        ${mgrStats}
      </div>

      <div class="p-cols">
        <div class="p-col">
          <div class="tab-section-label">Aujourd'hui — ${esc(jourComplet(new Date()))}</div>
          ${ferie ? `<div class="plain-card"><div class="pc-icon red">🎌</div><div class="pc-body"><div class="pc-title">Jour férié</div><div class="pc-meta">${esc(ferie)} — cabinet fermé.</div></div></div>` : ""}
          ${!ferie && ferm ? `<div class="plain-card"><div class="pc-icon amber">🔒</div><div class="pc-body"><div class="pc-title">Cabinet fermé</div><div class="pc-meta">${esc(ferm.nom)}</div></div></div>` : ""}
          ${absents.map(x => { const t = PLANNING_TYPES[x.e.type] || PLANNING_TYPES.absence; return `<div class="plain-card">
            <div class="pc-icon amber">${avatar(x.m, 30)}</div>
            <div class="pc-body"><div class="pc-title">${esc(membreNom(x.m.id))}</div>
            <div class="pc-meta">${t.ico} ${esc(t.label)}${x.e.note ? " · " + esc(x.e.note) : ""}</div></div></div>`; }).join("")}
          ${(!ferie && !ferm && !absents.length) ? `<p class="pc-meta">Aucune absence prévue aujourd'hui. ✅</p>` : ""}
          ${presents.length ? `<p class="pc-meta" style="margin-top:8px">Prévu·es : ${presents.map(m => esc(m.prenom)).join(", ")}.</p>` : ""}
        </div>

        <div class="p-col">
          <div class="tab-section-label">${mgr ? "Demandes à traiter" : "Mes demandes"}</div>
          ${mgr
            ? (enAttente.length ? enAttente.map(demandeCard).join("") : `<p class="pc-meta">Aucune demande en attente. ✅</p>`)
            : (() => { const mine = state.demandes.filter(d => d.membreId === sessionUser.id).slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 5); return mine.length ? mine.map(demandeCard).join("") : `<p class="pc-meta">Aucune demande. Utilisez l'onglet « Demandes » pour en créer une.</p>`; })()}
        </div>
      </div>

      ${sessionUser.salarie ? carteConges(sessionUser) : ""}
      ${mgr ? `<div class="tab-section-label" style="margin-top:22px">Raccourcis employeur</div>
        <div class="p-shortcuts">
          <button class="btn btn-soft" data-pact="goto-suivi">🔒 Noter un retard, des heures sup. ou une absence</button>
          <button class="btn btn-soft" data-pact="goto-resume">🧾 Préparer le résumé pour le comptable</button>
          <button class="btn btn-soft" data-pact="goto-bilan">📅 Voir le bilan annuel</button>
        </div>` : ""}
    `;
  }
  // Encadré « Mes congés payés » (toute personne salariée connectée)
  function carteConges(m) {
    const cp = situationConges(m, 0);
    const a = cp.acq;
    const depuis = a.mode === "fixe" ? "" : ` depuis le ${fmtLong(a.depuis)} (${a.mois} mois complet${a.mois > 1 ? "s" : ""})`;
    return `
      <div class="tab-section-label" style="margin-top:22px">Mes congés payés — période ${esc(cp.per.label)}</div>
      <div class="cp-card">
        <div class="cp-stat"><div class="cp-n">${fmtNum(cp.acq.total)} j</div><div class="cp-l">acquis à ce jour (jours ${uniteLabel()})${a.report ? `<br><span>dont ${fmtNum(a.report)} j de report</span>` : ""}</div></div>
        <div class="cp-stat"><div class="cp-n">${fmtNum(cp.pris)} j</div><div class="cp-l">pris sur la période</div></div>
        <div class="cp-stat cp-solde"><div class="cp-n">${fmtNum(cp.solde)} j</div><div class="cp-l">solde disponible</div></div>
        <div class="cp-stat"><div class="cp-n">${fmtNum(cp.soldeFin)} j</div><div class="cp-l">solde prévu au ${fmtDate(cp.per.to)}</div></div>
      </div>
      <p class="pc-meta" style="margin-top:8px">${a.mode === "fixe" ? `Droit annuel de ${fmtNum(m.congesAcquis || 0)} jours ${uniteLabel()}.` : `${fmtNum(m.congesAcquis || 0)} jours ${uniteLabel()} par an, soit ${String(Math.round(a.taux * 100) / 100).replace(".", ",")} j acquis par mois complet de présence${depuis}.`} ${enOuvrables() ? "Chaque congé est décompté du premier jour d'absence jusqu'au dernier jour ouvrable avant la reprise, samedi compris (une semaine = 6 jours)." : "Seuls les jours du lundi au vendredi sont décomptés (une semaine = 5 jours)."} Les congés pris comprennent les congés validés, les fermetures du cabinet et les jours notés par l'employeur.</p>
    `;
  }

  /* =========================================================
     BILAN ANNUEL (employeur uniquement)
     Par personne : absences par type (jours et épisodes), retards,
     heures supplémentaires, situation des congés payés.
     ========================================================= */
  function buildBilan() {
    const today = iso(new Date());
    const per = periodeRef(today, view.bilanOffset);
    const asOf = today < per.to ? (today < per.from ? per.from : today) : per.to;
    const blocs = membresTries().map(m => {
      const st = absencesPour(m, per.from, per.to);
      const acq = acquisConges(m, per, asOf);
      const pris = congesPrisPeriode(m, per.from, per.to);
      return { m, nom: m.prenom + " " + m.nom, st, acq, pris, solde: round1(acq.total - pris) };
    });
    const equipe = blocs.reduce((t, b) => { t.jours += b.st.joursAbs; t.episodes += b.st.episodes; t.retards += b.st.nbRetards; t.retardMin += b.st.retardMin; t.supMin += b.st.supMin; return t; }, { jours: 0, episodes: 0, retards: 0, retardMin: 0, supMin: 0 });
    // Texte brut
    const out = ["Cabinet dentaire Cybèle Dent — Bilan annuel du personnel — " + per.label + " (" + per.detail + ")", "Établi le " + fmtLong(today), ""];
    blocs.forEach(b => {
      out.push(b.nom + " (" + b.m.role + ")");
      out.push("  Absences : " + bilanAbsTexte(b.st));
      out.push("  Retards : " + (b.st.nbRetards ? b.st.nbRetards + " (" + fmtDuree(b.st.retardMin) + " au total)" : "aucun"));
      out.push("  Heures supplémentaires : " + (b.st.supMin ? fmtDuree(b.st.supMin) : "aucune"));
      if (b.m.salarie) out.push("  Congés payés (jours " + uniteLabel() + ") : acquis " + fmtNum(b.acq.total) + " j" + (b.acq.report ? " (dont report " + fmtNum(b.acq.report) + " j)" : "") + " · pris " + fmtNum(b.pris) + " j · solde " + fmtNum(b.solde) + " j");
      out.push("");
    });
    out.push("Équipe : " + fmtJours(equipe.jours) + " d'absence (" + equipe.episodes + " épisode" + (equipe.episodes > 1 ? "s" : "") + ") · " + equipe.retards + " retard" + (equipe.retards > 1 ? "s" : "") + " (" + fmtDuree(equipe.retardMin) + ") · " + fmtDuree(equipe.supMin) + " d'heures supplémentaires");
    return { per, asOf, blocs, equipe, texte: out.join("\n") };
  }
  function bilanAbsTexte(st) {
    if (!st.episodes) return "aucune";
    const parts = Object.keys(st.parType).sort((a, b) => st.parType[b].jours - st.parType[a].jours)
      .map(k => lc1(k) + " " + (/^Congé payé/.test(k) ? fmtCP(st.parType[k].cout) : fmtJours(st.parType[k].jours)) + " (" + st.parType[k].episodes + " fois)");
    return fmtJours(st.joursAbs) + " en " + st.episodes + " épisode" + (st.episodes > 1 ? "s" : "") + " — " + parts.join(" · ");
  }
  function viewBilan() {
    const b = buildBilan();
    return `
      <div class="pl-toolbar">
        <button class="btn-nav" data-pact="bilan-prev">‹</button>
        <div class="pl-week">Période ${esc(b.per.label)}</div>
        <button class="btn-nav" data-pact="bilan-next">›</button>
        <button class="btn btn-soft" data-pact="bilan-today">Période en cours</button>
        <span style="flex:1"></span>
        <button class="btn btn-soft" data-pact="bilan-copy">📋 Copier</button>
        <button class="btn btn-soft" data-pact="bilan-print">🖨 Imprimer</button>
        <button class="btn btn-soft" data-pact="params-planning">⚙ Réglages congés</button>
      </div>
      <div class="sv-private">🔒 Visible uniquement par vous. ${esc(b.per.detail.charAt(0).toUpperCase() + b.per.detail.slice(1))} · congés acquis calculés au ${esc(fmtLong(b.asOf))}.</div>
      <div class="rs-sheet" id="bl-sheet">
        <div class="rs-title">Cabinet dentaire Cybèle Dent — Bilan annuel du personnel</div>
        <div class="rs-sub">Période ${esc(b.per.label)} · établi le ${esc(fmtLong(iso(new Date())))}</div>
        <div class="bl-equipe">
          <div class="cp-stat"><div class="cp-n">${fmtNum(b.equipe.jours)} j</div><div class="cp-l">d'absence dans l'équipe<br><span>${b.equipe.episodes} épisode${b.equipe.episodes > 1 ? "s" : ""}</span></div></div>
          <div class="cp-stat"><div class="cp-n">${b.equipe.retards}</div><div class="cp-l">retard${b.equipe.retards > 1 ? "s" : ""}<br><span>${fmtDuree(b.equipe.retardMin)} au total</span></div></div>
          <div class="cp-stat"><div class="cp-n">${fmtHM(b.equipe.supMin)}</div><div class="cp-l">heures supplémentaires</div></div>
        </div>
        ${b.blocs.map(x => `<div class="rs-bloc bl-bloc">
          <div class="rs-nom">${avatar(x.m, 26)} ${esc(x.nom)} <span class="pc-meta">· ${esc(x.m.role)}</span></div>
          <div class="bl-grid">
            <div class="bl-item"><div class="bl-k">Absences</div><div class="bl-v">${x.st.episodes ? `<strong>${fmtJours(x.st.joursAbs)}</strong> en ${x.st.episodes} épisode${x.st.episodes > 1 ? "s" : ""}` : "aucune"}</div>
              ${x.st.episodes ? `<ul class="bl-types">${Object.keys(x.st.parType).sort((p, q) => x.st.parType[q].jours - x.st.parType[p].jours).map(k => `<li>${absIco(k)} ${esc(k)} : <strong>${/^Congé payé/.test(k) ? fmtCP(x.st.parType[k].cout) : fmtJours(x.st.parType[k].jours)}</strong> <span class="pc-meta">(${x.st.parType[k].episodes} fois)</span></li>`).join("")}</ul>` : ""}</div>
            <div class="bl-item"><div class="bl-k">Retards</div><div class="bl-v">${x.st.nbRetards ? `<strong>${x.st.nbRetards}</strong> · ${fmtDuree(x.st.retardMin)} au total` : "aucun"}</div></div>
            <div class="bl-item"><div class="bl-k">Heures sup.</div><div class="bl-v">${x.st.supMin ? `<strong>${fmtDuree(x.st.supMin)}</strong>` : "aucune"}</div></div>
            ${x.m.salarie ? `<div class="bl-item"><div class="bl-k">Congés payés (jours ${uniteLabel()})</div><div class="bl-v">acquis <strong>${fmtNum(x.acq.total)} j</strong>${x.acq.report ? ` <span class="pc-meta">(dont report ${fmtNum(x.acq.report)})</span>` : ""} · pris <strong>${fmtNum(x.pris)} j</strong> · solde <strong class="${x.solde < 0 ? "t-neg" : ""}">${fmtNum(x.solde)} j</strong></div></div>` : ""}
          </div>
        </div>`).join("")}
      </div>
      <textarea id="bl-text" hidden>${esc(b.texte)}</textarea>
    `;
  }
  function bilanCopy() {
    const t = document.getElementById("bl-text");
    const txt = t ? t.value : buildBilan().texte;
    const done = () => toast("Bilan copié.");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done).catch(() => fallbackCopy(txt, done));
    else fallbackCopy(txt, done);
  }
  function jourComplet(d) {
    const jn = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"][d.getDay()];
    return jn.charAt(0).toUpperCase() + jn.slice(1) + " " + d.getDate() + " " + MOIS[d.getMonth()] + " " + d.getFullYear();
  }

  /* =========================================================
     VUE — PLANNING (semaine, partagé)
     ========================================================= */
  function viewPlanning() {
    const ws = view.weekStart;
    const nDays = state.reglages.afficherWeekend ? 7 : 5;
    const days = Array.from({ length: nDays }, (_, i) => isoAdd(ws, i));
    const todayI = iso(new Date());
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

    const rows = membresActifs().map(m => {
      const cells = days.map((d, i) => {
        const info = dayInfo[i];
        if (info.ferie) return `<div class="pl-cell pl-ferie-cell pl-col-ferie" data-pferie="${esc(info.ferie)}" title="Jour férié — ${esc(info.ferie)} (cabinet fermé)"><span class="pl-type">🎌 Férié</span><span class="pl-hours">Fermé</span></div>`;
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
      ${membresActifs().length ? `<div class="pl-grid ${nDays === 7 ? "d7" : "d5"}">${head}${rows}</div>` : emptyBox("👤", "Aucun membre", "Ajoutez d'abord des membres dans l'onglet « Membres ».")}
      <p class="pc-meta pl-tip" style="margin-top:10px">Astuce : cliquez sur une case pour définir présence (un ou plusieurs créneaux), congé, absence…</p>
    `;
  }

  /* =========================================================
     VUE — SUIVI PRIVÉ (employeur uniquement)
     Retards, heures supplémentaires, absences — mois par mois.
     ========================================================= */
  function viewSuivi() {
    const ym = view.monthRef, [y, mo] = ym.split("-").map(Number);
    const { from, to } = monthBounds(ym);
    const showWE = !!state.reglages.afficherWeekend;
    const days = [];
    for (let d = from; d <= to; d = isoAdd(d, 1)) if (showWE || !isWeekend(d)) days.push(d);
    const todayI = iso(new Date());
    const membres = membresTries();

    const head = `<div class="sv-row sv-head">
      <div class="sv-name">Membre</div>
      ${days.map(d => {
        const f = ferieNom(d), fm = fermetureFor(d);
        const cls = (d === todayI ? "today " : "") + (f ? "sv-ferie" : fm ? "sv-ferm" : isWeekend(d) ? "sv-we" : "");
        return `<div class="sv-cell sv-dayhead ${cls}" title="${esc(fmtDate(d))}${f ? " — " + esc(f) : fm ? " — " + esc(fm.nom) : ""}"><span class="sv-dow">${JOURS_1[weekdayOf(d)]}</span>${Number(d.slice(8))}</div>`;
      }).join("")}
      <div class="sv-total">Total</div>
    </div>`;

    const rows = membres.map(m => {
      let nRet = 0, minRet = 0, minSup = 0, jAbs = 0;
      const cells = days.map(d => {
        const s = suiviOf(m.id, d);
        const f = ferieNom(d), fm = fermetureFor(d);
        const colCls = f ? " sv-col-ferie" : fm ? " sv-col-ferm" : isWeekend(d) ? " sv-col-we" : "";
        if (!s || suiviVide(s)) {
          // rappel discret du planning partagé (congé validé, maladie…) pour ne rien oublier
          const e = state.planning.find(p => p.membreId === m.id && p.date === d && p.type !== "present" && p.type !== "repos");
          const hint = e ? `<span class="sv-hint" title="Planning : ${esc((PLANNING_TYPES[e.type] || {}).label || e.type)}${e.note ? " — " + esc(e.note) : ""}">${(PLANNING_TYPES[e.type] || {}).ico || ""}</span>` : "";
          return `<div class="sv-cell sv-empty${colCls}" data-scell="${m.id}|${d}">${hint}</div>`;
        }
        const marks = [];
        if (s.absence) { const demi = s.duree !== "journee"; jAbs += demi ? 0.5 : 1; marks.push(`<span class="sv-mark sv-abs" title="${esc(s.absence)} (${DUREES[s.duree] || "journée"})">${absIco(s.absence)}${demi ? "½" : ""}</span>`); }
        if (s.retardMin) { nRet++; minRet += s.retardMin; marks.push(`<span class="sv-mark sv-ret" title="Retard de ${esc(fmtDuree(s.retardMin))}">⏰${s.retardMin}</span>`); }
        if (s.supMin) { minSup += s.supMin; marks.push(`<span class="sv-mark sv-sup" title="${esc(fmtDuree(s.supMin))} d'heures supplémentaires">➕${fmtHM(s.supMin)}</span>`); }
        if (!marks.length && s.note) marks.push(`<span class="sv-mark sv-note" title="${esc(s.note)}">📝</span>`);
        return `<div class="sv-cell sv-filled${colCls}" data-scell="${m.id}|${d}" title="${esc(s.note || "")}">${marks.join("")}</div>`;
      }).join("");
      const tot = [];
      if (jAbs) tot.push(`<span class="sv-tot-abs">${fmtJours(jAbs)} abs.</span>`);
      if (nRet) tot.push(`<span class="sv-tot-ret">${nRet} retard${nRet > 1 ? "s" : ""} (${fmtDuree(minRet)})</span>`);
      if (minSup) tot.push(`<span class="sv-tot-sup">+${fmtHM(minSup)} sup.</span>`);
      return `<div class="sv-row">
        <div class="sv-name">${avatar(m, 28)}<div><div class="pl-mn">${esc(m.prenom)} ${esc(m.nom)}</div><div class="pl-mr">${esc(m.role)}</div></div></div>
        ${cells}
        <div class="sv-total">${tot.length ? tot.join("") : `<span class="pc-meta">—</span>`}</div>
      </div>`;
    }).join("");

    return `
      <div class="pl-toolbar">
        <button class="btn-nav" data-pact="month-prev">‹</button>
        <div class="pl-week">${MOIS[mo - 1].charAt(0).toUpperCase() + MOIS[mo - 1].slice(1)} ${y}</div>
        <button class="btn-nav" data-pact="month-next">›</button>
        <button class="btn btn-soft" data-pact="month-today">Ce mois-ci</button>
        <button class="btn btn-primary" data-pact="suivi-add">＋ Noter</button>
        <span style="flex:1"></span>
        <div class="pl-legend">
          <span class="pl-leg sv-leg-ret">⏰ Retard (min)</span>
          <span class="pl-leg sv-leg-sup">➕ Heures sup.</span>
          <span class="pl-leg sv-leg-abs">🌴 Congé payé · 🌙 Sans solde · 🟠 Absence · 🔴 Maladie</span>
        </div>
      </div>
      <div class="sv-private">🔒 Cet onglet n'est visible que par vous (compte employeur). Les membres de l'équipe ne voient pas ces informations.</div>
      ${membres.length ? `<div class="sv-grid-wrap"><div class="sv-grid" style="--sv-days:${days.length}">${head}${rows}</div></div>` : emptyBox("👤", "Aucun membre", "Ajoutez d'abord des membres dans l'onglet « Membres ».")}
      <p class="pc-meta pl-tip" style="margin-top:10px">Cliquez sur une case pour noter un retard, des heures supplémentaires ou une absence. Les petites icônes grisées rappellent ce qui est déjà dans le planning partagé (congés validés, maladie…) et seront reprises automatiquement dans le résumé comptable.</p>
    `;
  }
  function absIco(type) {
    if (/sans solde/i.test(type)) return "🌙";
    if (/Congé payé|RTT/i.test(type)) return "🌴";
    if (/Maladie/i.test(type)) return "🔴";
    if (/Formation/i.test(type)) return "🎓";
    return "🟠";
  }

  /* ---- Modale de suivi (une personne, un jour) ---- */
  function modalSuivi(membreId, date) {
    if (!isManager()) { toast("Réservé à l'employeur."); return; }
    const pick = !membreId || !date; // mode "＋ Noter" : on choisit la personne et la date
    const existing = (!pick) ? suiviOf(membreId, date) : null;
    const s = existing || { retardMin: 0, supMin: 0, absence: "", duree: "journee", note: "" };
    const opts = membresTries().map(m => ({ v: m.id, l: m.prenom + " " + m.nom }));
    const supH = s.supMin ? fmtHM(s.supMin) : "";
    const body = `
      ${pick ? `<div class="field-row">${fSelect("membreId", "Personne", opts[0] && opts[0].v, opts)}${fText("date", "Date", iso(new Date()), { type: "date" })}</div>`
             : `<p class="pc-meta" style="margin-bottom:12px"><strong>${esc(membreNom(membreId))}</strong> — ${esc(fmtLong(date))}</p>`}
      <div class="sv-form-block">
        <div class="sv-form-title">⏰ Retard</div>
        ${fText("retard", "Minutes de retard (vide = pas de retard)", s.retardMin || "", { type: "number", ph: "ex. 15", attrs: ' min="0" step="5" inputmode="numeric"' })}
      </div>
      <div class="sv-form-block">
        <div class="sv-form-title">➕ Heures supplémentaires</div>
        ${fText("sup", "Durée (vide = aucune)", supH, { ph: "ex. 1h30 ou 45 min" })}
        <p class="field-hint">Écrivez par exemple « 1h30 », « 45 min » ou « 2h ».</p>
      </div>
      <div class="sv-form-block">
        <div class="sv-form-title">🚫 Absence</div>
        ${fSelect("absence", "Type", s.absence, [{ v: "", l: "— Pas d'absence —" }].concat(SUIVI_ABSENCES))}
        ${fSelect("duree", "Durée", s.duree || "journee", [{ v: "journee", l: "Journée entière" }, { v: "matin", l: "Matin seulement" }, { v: "apresmidi", l: "Après-midi seulement" }])}
      </div>
      ${fText("note", "Note (facultatif, visible uniquement par vous)", s.note, { ph: "ex. prévenu la veille" })}
    `;
    const ov = openModal(existing ? "Modifier le suivi" : "Noter dans le suivi privé", body, (ov) => {
      const mid = pick ? val(ov, "membreId") : membreId;
      const d = pick ? val(ov, "date") : date;
      if (!mid || !d) { toast("Choisissez la personne et la date."); return false; }
      const retard = Math.max(0, parseInt(val(ov, "retard"), 10) || 0);
      const supRaw = val(ov, "sup");
      const sup = parseDuree(supRaw);
      if (supRaw && sup == null) { toast("Durée d'heures sup. non comprise — écrivez par exemple 1h30 ou 45 min."); return false; }
      const absence = val(ov, "absence");
      const data = { membreId: mid, date: d, retardMin: retard, supMin: sup, absence, duree: absence ? val(ov, "duree") : "journee", note: val(ov, "note") };
      const target = suiviOf(mid, d);
      if (suiviVide(data)) {
        if (target) { prive.suivi = prive.suivi.filter(x => x !== target); savePrive(); renderTab(); toast("Suivi effacé pour ce jour."); }
        return;
      }
      if (target) Object.assign(target, data); else prive.suivi.push({ id: uid(), ...data });
      savePrive();
      if (pick) view.monthRef = d.slice(0, 7);
      renderTab();
      toast("Suivi enregistré.");
    });
    if (existing) {
      const foot = ov.querySelector(".modal-foot");
      const del = document.createElement("button");
      del.className = "btn btn-soft"; del.textContent = "Effacer"; del.style.flex = "0 0 auto";
      del.onclick = () => { prive.suivi = prive.suivi.filter(x => x !== existing); savePrive(); renderTab(); modalRoot.innerHTML = ""; toast("Suivi effacé."); };
      foot.insertBefore(del, foot.firstChild);
    }
    const toggleDuree = () => { const sel = ov.querySelector("[name=duree]").closest(".field"); sel.style.display = ov.querySelector("[name=absence]").value ? "block" : "none"; };
    ov.querySelector("[name=absence]").onchange = toggleDuree; toggleDuree();
  }

  /* =========================================================
     RÉSUMÉ COMPTABLE (employeur uniquement)
     Texte simple, une ligne par événement, prêt à copier/envoyer.
     ========================================================= */
  // Événements d'une personne sur une période : suivi privé + planning partagé (congés validés, maladie…)
  function evenementsPour(m, from, to) {
    const ev = [];
    for (let d = from; d <= to; d = isoAdd(d, 1)) {
      const s = suiviOf(m.id, d);
      if (s) {
        if (s.absence) ev.push({ kind: "abs", date: d, label: s.absence, demi: s.duree !== "journee" ? s.duree : "", note: s.note });
        if (s.retardMin) ev.push({ kind: "retard", date: d, min: s.retardMin, note: s.absence ? "" : s.note });
        if (s.supMin) ev.push({ kind: "sup", date: d, min: s.supMin, note: (s.absence || s.retardMin) ? "" : s.note });
      }
      if (s && s.absence) continue;        // le suivi privé prime sur le planning pour ce jour
      if (!isOuvre(d)) continue;           // week-end et jours fériés : rien à signaler
      const fm = fermetureFor(d);
      if (fm) { if (m.salarie) ev.push({ kind: "abs", date: d, label: "Congé payé (fermeture du cabinet)", demi: "", note: "" }); continue; }
      const p = state.planning.find(x => x.membreId === m.id && x.date === d);
      if (!p || p.type === "present" || p.type === "repos") continue;
      let label;
      if (p.type === "conge") label = /Congé payé|RTT/i.test(p.note || "") ? (p.note.match(/Congé payé|RTT/i)[0]) : "Congé payé";
      else if (p.type === "conge_ss") label = "Congé sans solde";
      else if (p.type === "maladie") label = "Maladie (arrêt)";
      else if (p.type === "formation") label = "Formation";
      else label = "Absence";
      ev.push({ kind: "abs", date: d, label, demi: "", note: "" });
    }
    return ev;
  }
  // Deux dates sont "consécutives" si seuls des week-ends / fériés les séparent
  function joursConsecutifs(a, b) {
    for (let d = isoAdd(a, 1); d < b; d = isoAdd(d, 1)) if (isOuvre(d)) return false;
    return b > a;
  }
  // Absences regroupées en périodes (épisodes) + statistiques, pour une personne et une période
  function absencesPour(m, from, to) {
    const ev = evenementsPour(m, from, to);
    const runs = [];
    ev.filter(e => e.kind === "abs").forEach(e => {
      const last = runs[runs.length - 1];
      if (last && last.label === e.label && !last.demi && !e.demi && joursConsecutifs(last.to, e.date)) { last.to = e.date; last.jours += 1; }
      else runs.push({ kind: "abs", label: e.label, from: e.date, to: e.date, jours: e.demi ? 0.5 : 1, demi: e.demi, note: e.note, date: e.date });
    });
    // Coût de chaque épisode de congé payé dans l'unité choisie (les autres absences restent en jours d'absence)
    runs.forEach(r => {
      r.cp = /^Congé payé/.test(r.label);
      r.cout = (r.cp && enOuvrables() && !r.demi) ? coutOuvrables(m, r.from, r.to) : r.jours;
    });
    const parType = {};
    runs.forEach(r => { const k = r.label.replace(/ \(fermeture du cabinet\)$/, ""); const t = parType[k] || (parType[k] = { jours: 0, cout: 0, episodes: 0 }); t.jours += r.jours; t.cout += r.cout; t.episodes++; });
    const retards = ev.filter(e => e.kind === "retard");
    return {
      ev, runs, parType,
      joursAbs: runs.reduce((s, r) => s + r.jours, 0), episodes: runs.length,
      nbRetards: retards.length, retardMin: retards.reduce((s, e) => s + e.min, 0),
      supMin: ev.filter(e => e.kind === "sup").reduce((s, e) => s + e.min, 0),
    };
  }
  function lignesPour(m, from, to) {
    const { ev, runs } = absencesPour(m, from, to);
    const items = runs.concat(ev.filter(e => e.kind !== "abs")).sort((a, b) => (a.date + a.kind).localeCompare(b.date + b.kind));
    const lines = items.map(it => {
      const note = it.note ? " — " + it.note : "";
      if (it.kind === "abs") {
        const lab = lc1(it.label);
        if (it.demi) return `${lab} le ${fmtLong(it.from)} (${DUREES[it.demi]})${note}`;
        // Congé payé : on indique les jours décomptés dans l'unité des contrats (ex. « 6 jours ouvrables »)
        const cpInfo = it.cp ? ` (${fmtCP(it.cout)}${it.cout !== it.jours ? " décomptés" : ""})` : "";
        if (it.from === it.to) return `${lab} le ${fmtLong(it.from)}${it.cp && it.cout !== it.jours ? cpInfo : ""}${note}`;
        return `${lab} ${fmtPeriode(it.from, it.to)}${it.cp ? cpInfo : ` (${fmtJours(it.jours)})`}${note}`;
      }
      if (it.kind === "retard") return `retard de ${fmtDuree(it.min)} le ${fmtLong(it.date)}${note}`;
      return `${fmtDuree(it.min)} d'heures supplémentaires le ${fmtLong(it.date)}${note}`;
    });
    // Totaux
    const totAbs = {};
    runs.forEach(r => { totAbs[r.label] = (totAbs[r.label] || 0) + r.cout; });
    const retards = ev.filter(e => e.kind === "retard"), sup = ev.filter(e => e.kind === "sup").reduce((t, e) => t + e.min, 0);
    const tot = Object.keys(totAbs).map(k => lc1(k) + " : " + (/^Congé payé/.test(k) ? fmtCP(totAbs[k]) : fmtJours(totAbs[k])));
    if (retards.length) tot.push(retards.length + " retard" + (retards.length > 1 ? "s" : "") + " (" + fmtDuree(retards.reduce((t, e) => t + e.min, 0)) + " au total)");
    if (sup) tot.push(fmtDuree(sup) + " d'heures supplémentaires");
    return { lines, total: tot };
  }
  function resumePeriode() {
    if (view.resumeDu && view.resumeAu && view.resumeAu >= view.resumeDu) return { from: view.resumeDu, to: view.resumeAu, titre: fmtPeriode(view.resumeDu, view.resumeAu).replace(/^le /, "") };
    const { from, to } = monthBounds(view.monthRef);
    const [y, mo] = view.monthRef.split("-").map(Number);
    return { from, to, titre: MOIS[mo - 1] + " " + y };
  }
  function buildResume() { // retourne { titre, blocs:[{nom, lines, total}], texte }
    const { from, to, titre } = resumePeriode();
    const membres = membresTries().filter(m => !view.resumeMembre || m.id === view.resumeMembre);
    const blocs = membres.map(m => ({ nom: m.prenom + " " + m.nom, role: m.role, ...lignesPour(m, from, to) }));
    const out = [];
    out.push("Cabinet dentaire Cybèle Dent — Résumé du personnel — " + titre);
    out.push("Établi le " + fmtLong(iso(new Date())));
    out.push("");
    blocs.forEach(b => {
      if (!b.lines.length) { out.push(b.nom + " : rien à signaler."); out.push(""); return; }
      b.lines.forEach(l => out.push(b.nom + " : " + l));
      if (b.total.length) out.push("  → Total " + b.nom + " : " + b.total.join(" · "));
      out.push("");
    });
    return { titre, from, to, blocs, texte: out.join("\n").trim() };
  }
  function viewResume() {
    const r = buildResume();
    const [y, mo] = view.monthRef.split("-").map(Number);
    const opts = [{ v: "", l: "Toute l'équipe" }].concat(membresTries().map(m => ({ v: m.id, l: m.prenom + " " + m.nom })));
    return `
      <div class="pl-toolbar">
        <button class="btn-nav" data-pact="month-prev">‹</button>
        <div class="pl-week">${MOIS[mo - 1].charAt(0).toUpperCase() + MOIS[mo - 1].slice(1)} ${y}</div>
        <button class="btn-nav" data-pact="month-next">›</button>
        <button class="btn btn-soft" data-pact="month-today">Ce mois-ci</button>
        <span style="flex:1"></span>
        <button class="btn btn-soft" data-pact="resume-copy">📋 Copier</button>
        <button class="btn btn-soft" data-pact="resume-print">🖨 Imprimer</button>
        <button class="btn btn-soft" data-pact="resume-dl">⬇ Fichier texte</button>
        <button class="btn btn-primary" data-pact="resume-mail">✉ Envoyer par email</button>
      </div>
      <div class="rs-filters">
        <div class="field"><label>Personne</label><select id="rs-membre">${opts.map(o => `<option value="${esc(o.v)}" ${o.v === view.resumeMembre ? "selected" : ""}>${esc(o.l)}</option>`).join("")}</select></div>
        <div class="field"><label>Période personnalisée — du</label><input type="date" id="rs-du" value="${esc(view.resumeDu)}"></div>
        <div class="field"><label>au</label><input type="date" id="rs-au" value="${esc(view.resumeAu)}"></div>
        ${(view.resumeDu || view.resumeAu) ? `<button class="btn btn-soft" data-pact="resume-reset" style="align-self:flex-end">✕ Revenir au mois</button>` : ""}
      </div>
      <div class="sv-private">🔒 Visible uniquement par vous. Le texte ci-dessous reprend le suivi privé <em>et</em> les congés / arrêts déjà notés dans le planning partagé.</div>
      <div class="rs-sheet" id="rs-sheet">
        <div class="rs-title">Cabinet dentaire Cybèle Dent — Résumé du personnel</div>
        <div class="rs-sub">${esc(r.titre)} · établi le ${esc(fmtLong(iso(new Date())))}</div>
        ${r.blocs.map(b => `<div class="rs-bloc">
          <div class="rs-nom">${esc(b.nom)} <span class="pc-meta">· ${esc(b.role)}</span></div>
          ${b.lines.length ? `<ul class="rs-lines">${b.lines.map(l => `<li>${esc(b.nom)} : ${esc(l)}</li>`).join("")}</ul>
            ${b.total.length ? `<div class="rs-total">Total : ${esc(b.total.join(" · "))}</div>` : ""}`
            : `<div class="rs-rien">Rien à signaler.</div>`}
        </div>`).join("")}
      </div>
      <textarea id="rs-text" hidden>${esc(r.texte)}</textarea>
    `;
  }
  function resumeTexte() { const t = document.getElementById("rs-text"); return t ? t.value : buildResume().texte; }
  function resumeCopy() {
    const txt = resumeTexte();
    const done = () => toast("Résumé copié — collez-le dans un email ou un document.");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done).catch(() => fallbackCopy(txt, done));
    else fallbackCopy(txt, done);
  }
  function fallbackCopy(txt, done) {
    const ta = document.createElement("textarea"); ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { toast("Copie impossible — sélectionnez le texte à la main."); }
    ta.remove();
  }
  function resumeDownload() {
    const r = buildResume();
    const blob = new Blob(["﻿" + r.texte], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "resume-personnel-" + r.from + "_" + r.to + ".txt";
    a.click(); URL.revokeObjectURL(a.href);
    toast("Fichier texte téléchargé.");
  }
  function resumeMail() {
    const r = buildResume();
    const subject = "Cybèle Dent — Résumé du personnel — " + r.titre;
    window.location.href = "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(r.texte);
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
    const mgr = isManager();
    const isOwnPending = sessionUser && d.membreId === sessionUser.id && d.statut === "en_attente";
    const actions = d.statut === "en_attente"
      ? (mgr
          ? `<button class="btn-mini ok" data-valide="${d.id}">✓ Valider</button>
             <button class="btn-mini no" data-refuse="${d.id}">✕ Refuser</button>
             <button class="icon-btn del" data-del-demande="${d.id}" title="Supprimer">🗑</button>`
          : (isOwnPending ? `<button class="icon-btn del" data-del-demande="${d.id}" title="Annuler ma demande">🗑</button>` : ""))
      : (mgr ? `<button class="icon-btn del" data-del-demande="${d.id}">🗑</button>` : "");
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
    const mgr = isManager();
    const authOn = !!(window.CybeleAuth && window.CybeleAuth.available);
    return `
      <div class="section-add" style="margin-bottom:16px"><button class="btn btn-primary" data-pact="add-membre">＋ Nouveau membre</button></div>
      ${state.membres.length ? state.membres.map(m => {
        const bin = m.binomeId ? membre(m.binomeId) : null;
        const cp = situationConges(m, 0);
        const compte = m.login ? `🔑 ${esc(m.login)}` : `<span style="color:var(--warn)">🔑 pas de compte</span>`;
        return `<div class="plain-card ${m.actif ? "" : "off"}">
          <div class="pc-icon" style="background:transparent">${avatar(m, 40)}</div>
          <div class="pc-body">
            <div class="pc-title">${esc(m.prenom)} ${esc(m.nom)} <span class="tag tag-type">${esc(m.role)}</span> ${m.isManager ? '<span class="tag tag-role">Employeur</span>' : ""} ${m.salarie ? "" : '<span class="tag tag-place">non-salarié·e</span>'} ${!m.actif ? '<span class="tag tag-cat-poubelle">Inactif</span>' : ""}</div>
            <div class="pc-meta">${m.heuresSemaine}h/sem.${bin ? " · 👥 " + esc(bin.prenom + " " + bin.nom) : ""}${m.salarie ? ` · 🌴 solde <strong>${fmtNum(cp.solde)} j</strong> (acquis ${fmtNum(cp.acq.total)} · pris ${fmtNum(cp.pris)})` : ""}${m.dateEntree ? " · entrée le " + fmtDate(m.dateEntree) : ""}${mgr ? " · PIN " + esc(m.pin) : ""}</div>
            ${authOn ? `<div class="pc-meta" style="margin-top:2px">${compte}</div>` : ""}
          </div>
          <div class="pc-actions">
            ${authOn && mgr ? `<button class="icon-btn" data-compte-membre="${m.id}" title="Compte de connexion">🔑</button>` : ""}
            ${mgr || (sessionUser && sessionUser.id === m.id) ? `<button class="icon-btn" data-edit-membre="${m.id}">✎</button>` : ""}
            ${mgr ? `<button class="icon-btn del" data-del-membre="${m.id}">🗑</button>` : ""}
          </div>
        </div>`;
      }).join("") : emptyBox("👤", "Aucun membre", "Ajoutez les praticiens, assistant·es et secrétaires du cabinet.")}
      ${authOn && mgr ? `<p class="pc-meta" style="margin-top:12px">🔑 Créez un compte de connexion pour chaque personne (identifiant + mot de passe). Elles s'y connecteront depuis leur téléphone.</p>` : ""}
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
      <div class="field-row">${fText("heuresSemaine", "Heures / semaine", m.heuresSemaine, { type: "number" })}${fText("congesAcquis", "Congés payés par an (jours " + uniteLabel() + ")", m.congesAcquis, { type: "number", attrs: ' step="0.5"' })}</div>
      <div class="field-row">${fText("dateEntree", "Date d'entrée", m.dateEntree, { type: "date" })}${fText("reportConges", "Report période précédente (jours)", m.reportConges || 0, { type: "number", attrs: ' step="0.5"' })}</div>
      <p class="field-hint" style="margin:-6px 0 12px">${enOuvrables() ? "30 jours ouvrables par an = 2,5 jours acquis par mois complet de présence (5 semaines)." : "25 jours ouvrés par an = 2,08 jours acquis par mois complet de présence (5 semaines)."} Le report s'ajoute au solde de la période en cours.</p>
      <div class="field-row">${fText("pin", "Code PIN (accès au module)", m.pin)}
        <div class="field"><label>Couleur</label><input type="color" name="couleur" value="${m.couleur}" style="height:44px;padding:4px"></div></div>
      <label class="chk-line" style="margin-bottom:10px"><input type="checkbox" name="salarie" ${m.salarie ? "checked" : ""}> Salarié·e — mis·e en congés lors des fermetures du cabinet</label>
      ${isManager() ? `<label class="chk-line" style="margin-bottom:14px"><input type="checkbox" name="isManager" ${m.isManager ? "checked" : ""}> Employeur — accès au suivi privé et au résumé comptable</label>` : ""}
      ${fSelect("actif", "Statut", m.actif ? "Actif" : "Inactif", ["Actif", "Inactif"])}
    `;
    openModal(isNew ? "Nouveau membre" : "Modifier le membre", body, (ov) => {
      const prenom = val(ov, "prenom"), nom = val(ov, "nom");
      if (!prenom || !nom) { toast("Prénom et nom obligatoires."); return false; }
      const data = {
        prenom, nom, role: val(ov, "role"), binomeId: val(ov, "binomeId"),
        heuresSemaine: parseFloat(val(ov, "heuresSemaine")) || 0, congesAcquis: parseFloat(val(ov, "congesAcquis")) || 0,
        dateEntree: val(ov, "dateEntree"), reportConges: parseFloat(val(ov, "reportConges")) || 0,
        pin: val(ov, "pin"), couleur: val(ov, "couleur"), actif: val(ov, "actif") === "Actif",
        salarie: ov.querySelector("[name=salarie]").checked,
      };
      const mgrChk = ov.querySelector("[name=isManager]");
      if (mgrChk) {
        if (!mgrChk.checked && m.isManager && state.membres.filter(x => x.isManager && x.id !== m.id).length === 0) { toast("Il faut au moins un compte employeur."); return false; }
        data.isManager = mgrChk.checked;
      }
      if (isNew) { const id = uid(); state.membres.push({ id, ...data }); reciprBinome(id, data.binomeId); }
      else { Object.assign(m, data); reciprBinome(m.id, data.binomeId); }
      save(); if (sessionUser && m.id === sessionUser.id) render(); else renderTab();
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
    if (!isManager()) { toast("Réservé à l'employeur."); return; }
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
    if (!slots.length) slots = (state.reglages.creneauxDefaut || []).map(c => ({ ...c }));
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

    slotEditor(ov.querySelector("#creneaux-list"), ov.querySelector("#add-creneau"), slots);

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
      const wd = weekdayOf(cur);
      if (jours.includes(wd) && !ferieNom(cur) && !fermetureFor(cur)) {
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
    const body = `
      <div class="tab-section-label" style="margin-top:0">Affichage</div>
      <label class="chk-line"><input type="checkbox" name="weekend" ${r.afficherWeekend ? "checked" : ""}> Afficher le samedi et le dimanche dans le planning</label>

      <div class="tab-section-label" style="margin-top:18px">Congés payés</div>
      ${fSelect("uniteConges", "Unité de décompte", r.uniteConges || "ouvrables", [{ v: "ouvrables", l: "Jours ouvrables — lundi à samedi, 30 j/an, règle légale (comme les contrats)" }, { v: "ouvres", l: "Jours ouvrés — lundi à vendredi, 25 j/an" }])}
      <div class="field-row">
        ${fSelect("modeConges", "Calcul des congés acquis", r.modeConges || "mensuel", [{ v: "mensuel", l: "1/12 du droit annuel par mois de présence" }, { v: "fixe", l: "Droit annuel entier dès le début de période" }])}
        ${fSelect("periodeRefMois", "Période de référence", String(r.periodeRefMois || 6), [{ v: "6", l: "Légale (1er juin → 31 mai)" }, { v: "1", l: "Année civile (1er janvier → 31 décembre)" }])}
      </div>
      <p class="field-hint" style="margin:-6px 0 0">Le droit annuel se règle dans la fiche de chaque membre. En changeant d'unité, les fiches encore à la valeur par défaut (30 ouvrables ou 25 ouvrés) sont converties automatiquement.</p>

      <div class="tab-section-label" style="margin-top:18px">Créneaux horaires par défaut</div>
      <p class="pc-meta" style="margin:-6px 0 8px">Servent au remplissage ci-dessous et pré-remplissent les nouvelles journées.</p>
      <div id="def-list"></div>
      <button type="button" class="btn-line" id="def-add" style="margin-bottom:2px">＋ Ajouter un créneau</button>

      <div class="tab-section-label" style="margin-top:18px">Appliquer sur une période</div>
      <div class="field"><label>Membre</label>
        <select name="cible">
          <option value="__all__">Tous les membres actifs</option>
          ${membresActifs().map(m => `<option value="${m.id}">${esc(m.prenom)} ${esc(m.nom)}</option>`).join("")}
        </select></div>
      <div class="field-row">${fText("periodeDu", "Du", "", { type: "date" })}${fText("periodeAu", "Au", "", { type: "date" })}</div>
      <label style="display:block;font-size:.85rem;font-weight:600;margin-bottom:6px">Jours concernés</label>
      <div class="jours-chk">
        ${JOURS.map((j, idx) => `<label class="chk-inline"><input type="checkbox" class="jour-chk" value="${idx}" ${idx < 5 ? "checked" : ""}> ${j}</label>`).join("")}
      </div>
      <label class="chk-line" style="margin-top:10px"><input type="checkbox" name="overwrite"> Remplacer les journées déjà renseignées</label>
      <button type="button" class="btn btn-primary" id="apply-periode" style="width:100%;justify-content:center;margin-top:12px">📅 Appliquer les horaires sur la période</button>
    `;
    const ov = openModal("Horaires par défaut & paramètres", body, (ov) => {
      state.reglages.afficherWeekend = ov.querySelector("[name=weekend]").checked;
      state.reglages.modeConges = val(ov, "modeConges") || "mensuel";
      state.reglages.periodeRefMois = Number(val(ov, "periodeRefMois")) || 6;
      const unite = val(ov, "uniteConges") || "ouvrables";
      if (unite !== (state.reglages.uniteConges || "ouvrables")) {
        // conversion des droits annuels laissés à la valeur par défaut
        const de = unite === "ouvrables" ? 25 : 30, vers = unite === "ouvrables" ? 30 : 25;
        state.membres.forEach(m => { if (Number(m.congesAcquis) === de) m.congesAcquis = vers; });
        state.reglages.congesAnnuelDefaut = vers;
        state.reglages.uniteConges = unite;
        toast("Décompte en jours " + (unite === "ouvrables" ? "ouvrables" : "ouvrés") + " activé.");
      }
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
      const ids = cible === "__all__" ? membresActifs().map(m => m.id) : [cible];
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
    while (cur <= f.au && guard++ < 800) { if (isOuvre(cur)) n++; cur = isoAdd(cur, 1); }
    return n;
  }

  function modalDemande() {
    const mgr = isManager();
    const opts = (mgr ? membresActifs() : [sessionUser]).map(m => ({ v: m.id, l: m.prenom + " " + m.nom }));
    const today = iso(new Date());
    const body = `
      ${fSelect("membreId", "Membre", sessionUser.id, opts)}
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
    if (statut === "valide") {
      // reporte sur le planning partagé
      const typeMap = { "Congé payé": "conge", "RTT": "conge", "Congé sans solde": "conge_ss", "Absence": "absence", "Maladie": "maladie", "Formation": "formation" };
      const pt = typeMap[d.type] || "absence";
      let cur = d.dateDebut, guard = 0;
      while (cur <= d.dateFin && guard++ < 400) {
        if (!isWeekend(cur)) {
          const ex = state.planning.find(p => p.membreId === d.membreId && p.date === cur);
          if (ex) { ex.type = pt; ex.debut = ""; ex.fin = ""; ex.creneaux = []; ex.note = d.type; }
          else state.planning.push({ id: uid(), membreId: d.membreId, date: cur, type: pt, debut: "", fin: "", creneaux: [], note: d.type });
        }
        cur = isoAdd(cur, 1);
      }
    }
    save(); render();
    toast(statut === "valide" ? "Demande validée et reportée sur le planning." : "Demande refusée.");
  }

  /* =========================================================
     ÉVÉNEMENTS (délégation, scopée au module Personnel)
     ========================================================= */
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#app-personnel") && !e.target.closest("#modal-root")) return;
    const t = e.target.closest("[data-ptab],[data-pact],[data-pcell],[data-scell],[data-pferie],[data-pferm],[data-edit-membre],[data-del-membre],[data-compte-membre],[data-del-fermeture],[data-valide],[data-refuse],[data-del-demande]");
    if (!t) return;

    if (t.dataset.ptab) { view.tab = t.dataset.ptab; return render(); }
    if (t.dataset.pferie) { toast("Jour férié (" + t.dataset.pferie + ") — cabinet fermé."); return; }
    if (t.dataset.pferm) { toast("Fermeture du cabinet : " + t.dataset.pferm + "."); return; }
    if (t.dataset.pcell) { const [mid, date] = t.dataset.pcell.split("|"); return modalCell(mid, date); }
    if (t.dataset.scell) { const [mid, date] = t.dataset.scell.split("|"); return modalSuivi(mid, date); }
    if (t.dataset.editMembre) {
      const m = membre(t.dataset.editMembre);
      if (!isManager() && (!sessionUser || sessionUser.id !== m.id)) { toast("Réservé à l'employeur."); return; }
      return modalMembre(m);
    }
    if (t.dataset.compteMembre) return modalCompte(membre(t.dataset.compteMembre));
    if (t.dataset.delMembre) {
      if (!isManager()) { toast("Réservé à l'employeur."); return; }
      if (confirm("Supprimer ce membre ? Son historique (planning, suivi) restera mais ne sera plus associé.")) { state.membres = state.membres.filter(x => x.id !== t.dataset.delMembre); save(); renderTab(); }
      return;
    }
    if (t.dataset.delFermeture) { if (confirm("Supprimer cette fermeture ?")) { state.fermetures = state.fermetures.filter(x => x.id !== t.dataset.delFermeture); save(); render(); modalFermetures(); } return; }
    if (t.dataset.valide) {
      if (!isManager()) { toast("Seul l'employeur peut valider une demande."); return; }
      return traiterDemande(t.dataset.valide, "valide");
    }
    if (t.dataset.refuse) {
      if (!isManager()) { toast("Seul l'employeur peut refuser une demande."); return; }
      return traiterDemande(t.dataset.refuse, "refuse");
    }
    if (t.dataset.delDemande) {
      const d = state.demandes.find(x => x.id === t.dataset.delDemande);
      if (!d || !sessionUser) return;
      if (!isManager() && (d.membreId !== sessionUser.id || d.statut !== "en_attente")) {
        toast("Vous ne pouvez annuler que vos propres demandes en attente."); return;
      }
      if (confirm("Supprimer cette demande ?")) { state.demandes = state.demandes.filter(x => x.id !== t.dataset.delDemande); save(); render(); }
      return;
    }

    switch (t.dataset.pact) {
      case "week-prev": view.weekStart = isoAdd(view.weekStart, -7); return renderTab();
      case "week-next": view.weekStart = isoAdd(view.weekStart, 7); return renderTab();
      case "week-today": view.weekStart = mondayOf(new Date()); return renderTab();
      case "month-prev": view.monthRef = shiftMonth(view.monthRef, -1); view.resumeDu = view.resumeAu = ""; return renderTab();
      case "month-next": view.monthRef = shiftMonth(view.monthRef, 1); view.resumeDu = view.resumeAu = ""; return renderTab();
      case "month-today": view.monthRef = ymOf(new Date()); view.resumeDu = view.resumeAu = ""; return renderTab();
      case "logout": sessionUser = null; view.tab = "dashboard"; render(); return;
      case "print-planning": window.print(); return;
      case "params-planning": return modalParametres();
      case "fermetures": return modalFermetures();
      case "add-membre": if (!isManager()) { toast("Réservé à l'employeur."); return; } return modalMembre(null);
      case "add-demande": return modalDemande();
      case "goto-suivi": view.tab = "suivi"; return render();
      case "goto-resume": view.tab = "resume"; return render();
      case "suivi-add": return modalSuivi(null, null);
      case "resume-copy": return resumeCopy();
      case "resume-print": window.print(); return;
      case "resume-dl": return resumeDownload();
      case "resume-mail": return resumeMail();
      case "resume-reset": view.resumeDu = view.resumeAu = ""; return renderTab();
      case "bilan-prev": view.bilanOffset--; return renderTab();
      case "bilan-next": view.bilanOffset++; return renderTab();
      case "bilan-today": view.bilanOffset = 0; return renderTab();
      case "bilan-copy": return bilanCopy();
      case "bilan-print": window.print(); return;
      case "goto-bilan": view.tab = "bilan"; return render();
    }
  });
  // Filtres du résumé (personne / période personnalisée)
  document.addEventListener("change", (e) => {
    if (!e.target.closest("#app-personnel")) return;
    if (e.target.id === "rs-membre") { view.resumeMembre = e.target.value; return renderTab(); }
    if (e.target.id === "rs-du" || e.target.id === "rs-au") {
      const du = document.getElementById("rs-du").value, au = document.getElementById("rs-au").value;
      view.resumeDu = du; view.resumeAu = au;
      if (du && au) { if (au < du) { toast("La date de fin précède le début."); return; } renderTab(); }
    }
  });

  /* =========================================================
     ENREGISTREMENT DANS LE SHELL (sauvegarde / restauration)
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
    window.CybeleShell.register("personnel-prive", {
      label: "Suivi privé",
      getState: () => prive,
      setState: (p) => {
        if (!p || !Array.isArray(p.suivi)) return false;
        prive = migratePrive(p); savePrive(); if (view.tab === "suivi" || view.tab === "resume") renderTab(); return true;
      },
    });
  }

  /* =========================================================
     CHARGEMENT INITIAL (Firestore → local → exemple)
     ========================================================= */
  async function loadCloud(key, ms) {
    return Promise.race([
      window.CybeleDB.load(key),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms || 6000))
    ]);
  }
  async function initPersonnel() {
    if (window.CybeleAuth) { try { await window.CybeleAuth.whenReady(); } catch (e) {} }
    if (window.CybeleDB) {
      try {
        const cloud = await loadCloud("personnel");
        if (cloud) {
          state = migrate(cloud);
          try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
        } else {
          state = loadLocal() || seed();
          if (!loadLocal()) save();
        }
      } catch (e) { state = loadLocal() || seed(); }
      try {
        const cp = await loadCloud("personnel-prive");
        prive = cp ? migratePrive(cp) : (loadPriveLocal() || migratePrive({}));
        if (cp) { try { localStorage.setItem(PRIVE_KEY, JSON.stringify(prive)); } catch (e) {} }
      } catch (e) { prive = loadPriveLocal() || migratePrive({}); }
    } else {
      state = loadLocal();
      if (!state) { state = seed(); save(); }
      prive = loadPriveLocal() || migratePrive({});
    }
    autoSelectSession();
    if (document.body.dataset.module === "personnel") render();
  }
  initPersonnel();
})();
