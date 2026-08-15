/* =========================================================
   CYBÈLE DENT — Gestion des équipements
   App autonome (vanilla JS). Données stockées en local
   (localStorage) + export/import par fichier de sauvegarde.
   ========================================================= */
(function () {
  "use strict";

  const STORE_KEY = "cybele-equipements-v1";

  /* ---------- Types par défaut (modifiables / extensibles) ---------- */
  const DEFAULT_TYPES = [
    "Turbine", "Contre-angle", "Fauteuil", "Autoclave", "Radio",
    "Climatisation", "Extincteur", "Imagerie", "Stérilisation", "Autre"
  ];

  const CARNET_CATS = ["Achat", "Maintenance", "Réparation", "Vente", "Poubelle"];
  const FREQUENCES = ["Ponctuel", "Hebdomadaire", "Mensuel", "Trimestriel", "Semestriel", "Annuel", "Biennal"];
  const CONTRAT_TYPES = ["Fin de garantie", "Fin de leasing", "Fin de contrat de maintenance", "Fin de location"];
  const DEFAULT_CONTACT_ROLES = ["SAV", "Réparateur", "Fournisseur", "Installateur", "Commercial(e)", "Autre"];
  const DEFAULT_CONTACT_CATEGORIES = ["Dentaire", "Stérilisation", "Informatique", "Plomberie", "Électricité", "Sécurité"];

  /* =========================================================
     ÉTAT
     ========================================================= */
  let state = null;
  let view = { name: "list", id: null, tab: "carnet", search: "", filter: "all", type: null };

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
  }

  function save() {
    // Sauvegarde locale (cache hors-ligne)
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {
      toast("⚠ Mémoire locale pleine : faites une sauvegarde.");
    }
    // Synchronisation Firestore (photos/docs sont des URLs, pas de binaires)
    if (window.CybeleDB) {
      window.CybeleDB.save("equipements", state).catch(() => {});
    }
  }

  // Convertit un dataURL base64 en Blob pour l'upload Storage
  function dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(",");
    const mime = header.match(/:(.*?);/)[1];
    const binary = atob(base64);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* =========================================================
     DONNÉES D'EXEMPLE (au premier lancement)
     ========================================================= */
  function seed() {
    const today = new Date();
    const d = (offsetDays) => {
      const x = new Date(today); x.setDate(x.getDate() + offsetDays);
      return x.toISOString().slice(0, 10);
    };
    return {
      types: DEFAULT_TYPES.slice(),
      equipements: [
        {
          id: uid(), nom: "Fauteuil Dentaire KaVo Estetica E80", marque: "KaVo", modele: "Estetica E80",
          type: "Fauteuil", lieu: "Salle 2", statut: "ok", photos: [],
          infos: { numeroSerie: "", dateAchat: "2023-09-01", prixAchat: "", notes: "" },
          carnet: [
            { id: uid(), date: d(-280), categorie: "Maintenance", description: "Révision annuelle complète", montant: "520", contact: "KaVo Kerr France", detail: "" },
            { id: uid(), date: d(-130), categorie: "Réparation", description: "Pédale repose-pied bloquée", montant: "180", contact: "KaVo Kerr France", detail: "" },
          ],
          regles: [
            { id: uid(), nom: "Révision annuelle", frequence: "Annuel", echeance: d(116), contact: "KaVo Kerr France" },
            { id: uid(), nom: "Changement filtres aspiration", frequence: "Trimestriel", echeance: d(-153), contact: "KaVo Kerr France" },
          ],
          contrats: [
            { id: uid(), type: "Fin de garantie", echeance: d(5) },
            { id: uid(), type: "Fin de leasing", echeance: "" },
          ],
          contacts: [
            { id: uid(), nom: "KaVo Kerr France", role: "SAV", tel: "01 41 06 64 64", email: "service.france@kavokerr.com" },
            { id: uid(), nom: "Proden Maintenance", role: "Réparateur", tel: "04 78 42 15 30", email: "maintenance@proden.fr" },
          ],
          documents: [],
        },
        {
          id: uid(), nom: "Autoclave Miele PG 8591", marque: "Miele", modele: "PG 8591",
          type: "Stérilisation", lieu: "Stérilisation", statut: "ok", photos: [],
          infos: { numeroSerie: "", dateAchat: "", prixAchat: "", notes: "" },
          carnet: [],
          regles: [{ id: uid(), nom: "Nettoyage filtre + bras de lavage", frequence: "Mensuel", echeance: d(-25), contact: "Miele Professional France" }],
          contrats: [{ id: uid(), type: "Fin de garantie", echeance: d(-445) }],
          contacts: [{ id: uid(), nom: "Miele Professional France", role: "SAV", tel: "", email: "" }],
          documents: [],
        },
        {
          id: uid(), nom: "Turbine NSK Ti-Max Z900L", marque: "NSK", modele: "Ti-Max Z900L",
          type: "Turbine", lieu: "Salle 1", statut: "panne", photos: [],
          infos: { numeroSerie: "", dateAchat: "", prixAchat: "", notes: "" },
          carnet: [],
          regles: [{ id: uid(), nom: "Calibration + lubrification", frequence: "Semestriel", echeance: d(120), contact: "Henry Schein Technique" }],
          contrats: [{ id: uid(), type: "Fin de garantie", echeance: d(-252) }],
          contacts: [{ id: uid(), nom: "Henry Schein Technique", role: "Réparateur", tel: "", email: "" }],
          documents: [],
        },
      ],
    };
  }

  /* =========================================================
     RÉPERTOIRE DE CONTACTS (partagé entre équipements)
     ========================================================= */
  // Migre les contacts embarqués (ancien format eq.contacts) vers un répertoire
  // central state.repertoire, et remplace par des références eq.contactIds.
  function normalize(s) {
    if (!s) return s;
    if (!s.types) s.types = DEFAULT_TYPES.slice();
    if (!Array.isArray(s.contactRoles) || !s.contactRoles.length) s.contactRoles = DEFAULT_CONTACT_ROLES.slice();
    if (!Array.isArray(s.contactCategories)) s.contactCategories = DEFAULT_CONTACT_CATEGORIES.slice();
    if (!Array.isArray(s.repertoire)) s.repertoire = [];
    (s.equipements || []).forEach(eq => {
      if (!Array.isArray(eq.contactIds)) eq.contactIds = [];
      if (Array.isArray(eq.contacts) && eq.contacts.length) {
        eq.contacts.forEach(ct => {
          if (!ct || !ct.nom) return;
          let rep = s.repertoire.find(r => (r.nom || "").toLowerCase() === (ct.nom || "").toLowerCase());
          if (!rep) {
            rep = { id: ct.id || uid(), nom: ct.nom || "", role: ct.role || "", tel: ct.tel || "", email: ct.email || "" };
            s.repertoire.push(rep);
          }
          if (!eq.contactIds.includes(rep.id)) eq.contactIds.push(rep.id);
        });
      }
      delete eq.contacts; // converti au format référencé
    });
    return s;
  }
  function contactById(id) { return (state.repertoire || []).find(c => c.id === id); }
  function eqContacts(eq) { return (eq.contactIds || []).map(contactById).filter(Boolean); }
  function equipmentsUsing(contactId) { return (state.equipements || []).filter(eq => (eq.contactIds || []).includes(contactId)); }

  /* =========================================================
     UTILITAIRES DATE / ÉCHÉANCES
     ========================================================= */
  const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

  function fmtDate(iso) {
    if (!iso) return "—";
    const dt = new Date(iso + "T00:00:00");
    if (isNaN(dt)) return iso;
    return dt.getDate() + " " + MOIS[dt.getMonth()] + " " + dt.getFullYear();
  }

  function daysUntil(iso) {
    if (!iso) return null;
    const dt = new Date(iso + "T00:00:00");
    if (isNaN(dt)) return null;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((dt - now) / 86400000);
  }

  // Renvoie {cls, label} pour un badge d'échéance
  function dueBadge(iso) {
    const n = daysUntil(iso);
    if (n === null) return { cls: "none", label: "Non défini" };
    if (n < 0) {
      const k = Math.abs(n);
      return { cls: "late", label: k < 60 ? "Retard " + k + "j" : "Retard " + Math.round(k / 30) + " mois" };
    }
    if (n <= 7) return { cls: "warn", label: n === 0 ? "Aujourd'hui" : "J-" + n };
    if (n <= 31) return { cls: "warn", label: "Dans " + n + " j" };
    if (n <= 90) return { cls: "ok", label: Math.round(n / 7) + " sem." };
    return { cls: "ok", label: Math.round(n / 30) + " mois" };
  }

  function dueBadgeLong(iso) {
    const n = daysUntil(iso);
    if (n === null) return { cls: "none", label: "Non défini" };
    if (n < 0) return { cls: "late", label: "En retard de " + Math.abs(n) + " jours" };
    if (n === 0) return { cls: "warn", label: "Aujourd'hui" };
    if (n <= 31) return { cls: "warn", label: "Dans " + n + " jours" };
    if (n <= 90) return { cls: "ok", label: "Dans " + n + " jours" };
    return { cls: "ok", label: "Dans " + Math.round(n / 30) + " mois" };
  }

  // Statut effectif d'un équipement (panne forcée, sinon calcul sur échéances)
  function equipState(eq) {
    if (eq.statut === "panne") return "panne";
    const allDue = [...(eq.regles || []).map(r => r.echeance), ...(eq.contrats || []).map(c => c.echeance)];
    const late = allDue.some(iso => { const n = daysUntil(iso); return n !== null && n < 0; });
    if (late || eq.statut === "maintenance") return "maint";
    return "ok";
  }

  function nextRule(eq) {
    const rules = (eq.regles || []).filter(r => r.echeance).slice().sort((a, b) => a.echeance.localeCompare(b.echeance));
    return rules[0] || null;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* =========================================================
     COMPRESSION D'IMAGE (pour tenir dans localStorage)
     ========================================================= */
  function readImageCompressed(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxSize || height > maxSize) {
            if (width > height) { height = Math.round(height * maxSize / width); width = maxSize; }
            else { width = Math.round(width * maxSize / height); height = maxSize; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* =========================================================
     RENDU — ROUTEUR
     ========================================================= */
  const app = document.getElementById("app");

  function render() {
    if (view.name === "detail") renderDetail();
    else if (view.name === "repertoire") renderRepertoire();
    else renderList();
    window.scrollTo(0, 0);
  }

  function getEq(id) { return state.equipements.find(e => e.id === id); }

  /* ---------- LISTE ---------- */
  function renderList() {
    const eqs = state.equipements;
    let late = 0, soon = 0;
    eqs.forEach(eq => {
      [...(eq.regles || []), ...(eq.contrats || [])].forEach(r => {
        const n = daysUntil(r.echeance);
        if (n === null) return;
        if (n < 0) late++; else if (n <= 31) soon++;
      });
    });

    const nMaint = eqs.filter(e => equipState(e) === "maint").length;
    const nPanne = eqs.filter(e => equipState(e) === "panne").length;

    // Filtrage
    const q = view.search.trim().toLowerCase();
    let filtered = eqs.filter(eq => {
      if (view.filter === "maint" && equipState(eq) !== "maint") return false;
      if (view.filter === "panne" && equipState(eq) !== "panne") return false;
      if (view.type && eq.type !== view.type) return false;
      if (q) {
        const hay = (eq.nom + " " + eq.marque + " " + eq.modele + " " + eq.type + " " + eq.lieu).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const typesUsed = [...new Set(eqs.map(e => e.type))];

    let html = `
      <div class="list-top">
        <h1 class="list-title">Équipements <span class="count">(${eqs.length})</span></h1>
        ${(late || soon) ? `<div class="alert-pill">⚠
          ${late ? `<span class="a-late">${late} en retard</span>` : ""}
          ${late && soon ? "·" : ""}
          ${soon ? `<span class="a-soon">${soon} à venir</span>` : ""}
        </div>` : ""}
        <span class="spacer"></span>
        <button class="btn btn-soft" data-nav="repertoire">📇 Répertoire</button>
        <button class="btn btn-primary" data-act="new-eq">＋ Nouvel équipement</button>
      </div>

      <div class="search-box">
        <input type="text" id="search" placeholder="Nom, catégorie, marque…" value="${esc(view.search)}">
      </div>

      <div class="filters">
        <button class="filter-pill ${view.filter === "all" ? "active" : ""}" data-filter="all">🔻 Tous <span class="badge">${eqs.length}</span></button>
        <button class="filter-pill f-maint ${view.filter === "maint" ? "active" : ""}" data-filter="maint">🛠 Maintenance <span class="badge">${nMaint}</span></button>
        <button class="filter-pill f-panne ${view.filter === "panne" ? "active" : ""}" data-filter="panne">✖ En panne <span class="badge">${nPanne}</span></button>
      </div>

      <div class="type-chips">
        <button class="type-chip ${!view.type ? "active" : ""}" data-type="">Tous les types</button>
        ${typesUsed.map(t => `<button class="type-chip ${view.type === t ? "active" : ""}" data-type="${esc(t)}">${esc(t)}</button>`).join("")}
      </div>
    `;

    if (filtered.length === 0) {
      html += `<div class="empty"><div class="em-ico">📦</div><h3>Aucun équipement</h3><p>Ajoutez votre premier équipement pour commencer.</p></div>`;
    } else {
      html += `<div class="cards-grid">${filtered.map(cardHTML).join("")}</div>`;
    }

    app.innerHTML = html;

    const s = document.getElementById("search");
    if (s) s.oninput = (e) => { view.search = e.target.value; const grid = renderListGridOnly(); };
  }

  // Re-render léger pendant la frappe (sans perdre le focus du champ)
  function renderListGridOnly() {
    const q = view.search.trim().toLowerCase();
    let filtered = state.equipements.filter(eq => {
      if (view.filter === "maint" && equipState(eq) !== "maint") return false;
      if (view.filter === "panne" && equipState(eq) !== "panne") return false;
      if (view.type && eq.type !== view.type) return false;
      if (q) {
        const hay = (eq.nom + " " + eq.marque + " " + eq.modele + " " + eq.type + " " + eq.lieu).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const grid = app.querySelector(".cards-grid");
    const empty = app.querySelector(".empty");
    const target = grid || empty;
    if (!target) return;
    if (filtered.length === 0) {
      target.outerHTML = `<div class="empty"><div class="em-ico">🔍</div><h3>Aucun résultat</h3><p>Essayez un autre mot-clé.</p></div>`;
    } else {
      target.outerHTML = `<div class="cards-grid">${filtered.map(cardHTML).join("")}</div>`;
    }
  }

  /* ---------- RÉPERTOIRE ---------- */
  function contactMeta(c) {
    return `${c.tel ? "📞 " + esc(c.tel) : ""}${c.tel && c.email ? "&nbsp;&nbsp;" : ""}${c.email ? "✉ " + esc(c.email) : ""}`;
  }
  function repertoireCardHTML(c) {
    const used = equipmentsUsing(c.id);
    return `<div class="plain-card contact-card">
      <div class="pc-icon">👤</div>
      <div class="pc-body">
        <div class="pc-title">${esc(c.nom)} ${c.role ? `<span class="tag tag-role" style="margin-left:6px">${esc(c.role)}</span>` : ""}</div>
        <div class="pc-meta">${contactMeta(c)}${(c.tel || c.email) ? " · " : ""}${used.length ? `🔧 ${used.length} équipement${used.length > 1 ? "s" : ""}` : "non rattaché"}</div>
      </div>
      <div class="pc-actions">
        <button class="icon-btn" data-edit-repertoire="${c.id}">✎</button>
        <button class="icon-btn del" data-del-repertoire="${c.id}">🗑</button>
      </div>
    </div>`;
  }

  function renderRepertoire() {
    const reps = (state.repertoire || []).slice().sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
    let html = `
      <button class="detail-back" data-nav="list">← Équipements</button>
      <div class="list-top">
        <h1 class="list-title">📇 Répertoire <span class="count">(${reps.length})</span></h1>
        <span class="spacer"></span>
        <button class="btn btn-soft" data-act="manage-lists">⚙ Rôles & catégories</button>
        <button class="btn btn-primary" data-act="new-repertoire">＋ Nouveau contact</button>
      </div>
      <p class="pc-meta" style="margin-bottom:16px">Vos contacts réutilisables, classés par catégorie. Créez-les une fois, puis ajoutez-les à vos équipements en un clic.</p>
    `;
    if (!reps.length) {
      html += `<div class="empty"><div class="em-ico">📇</div><h3>Répertoire vide</h3><p>Ajoutez votre premier contact réutilisable.</p></div>`;
    } else {
      // Regroupement par catégorie (ordre de la liste des catégories, puis « Sans catégorie »)
      const byCat = {};
      reps.forEach(c => { const k = c.categorie || ""; (byCat[k] = byCat[k] || []).push(c); });
      const order = (state.contactCategories || []).filter(cat => byCat[cat]);
      Object.keys(byCat).forEach(k => { if (k && !order.includes(k)) order.push(k); });
      const groups = order.map(cat => ({ cat, items: byCat[cat] }));
      if (byCat[""]) groups.push({ cat: "", items: byCat[""] });
      html += groups.map(g => `
        <div class="tab-section-label" style="margin-top:20px">${g.cat ? "📂 " + esc(g.cat) : "Sans catégorie"} <span style="color:var(--muted);font-weight:400">(${g.items.length})</span></div>
        ${g.items.map(repertoireCardHTML).join("")}
      `).join("");
    }
    app.innerHTML = html;
  }

  function cardHTML(eq) {
    const st = equipState(eq);
    const stClass = st === "panne" ? "s-panne" : st === "maint" ? "s-maint" : "";
    const rule = nextRule(eq);
    const garantie = (eq.contrats || []).find(c => c.type === "Fin de garantie");
    const mainContact = eqContacts(eq)[0];
    const thumb = (eq.photos && eq.photos[0])
      ? `<img class="eq-card-thumb" src="${eq.photos[0]}" alt="">`
      : `<div class="eq-card-thumb">${typeEmoji(eq.type)}</div>`;

    return `
      <div class="eq-card ${stClass}" data-open="${eq.id}">
        <div class="eq-card-head">
          ${thumb}
          <div class="eq-card-titles">
            <div class="eq-card-name">${esc(eq.nom)}</div>
            <div class="eq-card-sub">${esc(eq.marque)}${eq.modele ? " · " + esc(eq.modele) : ""}</div>
            ${st === "panne" ? `<span class="eq-status-dot panne">● En panne</span>` : ""}
            <div style="margin-top:6px"><span class="tag tag-type">${esc(eq.type)}</span></div>
          </div>
        </div>
        <div class="eq-card-rules">
          ${rule ? `<div class="rule-line"><span class="ico">🔧</span><span class="rl-name">${esc(rule.nom)}</span><span class="rl-date">${fmtDate(rule.echeance)}</span> ${badgeHTML(dueBadge(rule.echeance))}</div>` : `<div class="rule-line"><span class="ico">🔧</span><span class="rl-name" style="color:var(--muted)">Aucune règle de maintenance</span></div>`}
          ${garantie ? `<div class="rule-line"><span class="ico">🛡</span><span class="rl-name">Garantie</span><span class="rl-date">${fmtDate(garantie.echeance)}</span> ${badgeHTML(garantieBadge(garantie.echeance))}</div>` : ""}
        </div>
        <div class="eq-card-foot">
          ${eq.lieu ? `<div class="ln">📍 ${esc(eq.lieu)}</div>` : ""}
          ${mainContact ? `<div class="ln">👤 ${esc(mainContact.nom)}${mainContact.role ? " · " + esc(mainContact.role) : ""}</div>` : ""}
        </div>
      </div>`;
  }

  function badgeHTML(b) { return `<span class="due-badge ${b.cls}">${esc(b.label)}</span>`; }

  function garantieBadge(iso) {
    const n = daysUntil(iso);
    if (n === null) return { cls: "none", label: "Non défini" };
    if (n < 0) return { cls: "late", label: "Expirée " + Math.abs(n) + "j" };
    if (n <= 31) return { cls: "warn", label: n === 0 ? "Aujourd'hui" : "Dans " + n + " j" };
    return { cls: "ok", label: Math.round(n / 30) + " mois" };
  }

  function typeEmoji(type) {
    const m = {
      "Turbine": "💨", "Contre-angle": "🦷", "Fauteuil": "🪑", "Autoclave": "♨️",
      "Radio": "📡", "Imagerie": "🖥", "Climatisation": "❄️", "Extincteur": "🧯",
      "Stérilisation": "♨️", "Autre": "🔧",
    };
    return m[type] || "🔧";
  }

  /* ---------- DÉTAIL ---------- */
  function renderDetail() {
    const eq = getEq(view.id);
    if (!eq) { view.name = "list"; return renderList(); }
    const st = equipState(eq);

    const photos = (eq.photos || []).map((p, i) => `
      <div class="photo-wrap">
        <img class="photo-thumb" src="${p}" data-lightbox="${i}" alt="">
        <button class="photo-del" data-delphoto="${i}" title="Supprimer">✕</button>
      </div>`).join("");

    let html = `
      <button class="detail-back" data-nav="list">← Équipements</button>
      <div class="detail-head">
        <div class="dh-titles">
          <h1 class="detail-title">🔧 ${esc(eq.nom)}</h1>
          <div class="detail-sub">${esc(eq.marque)}${eq.modele ? " · " + esc(eq.modele) : ""}</div>
        </div>
        <div class="detail-head-actions">
          <button class="link-action" data-act="edit-eq">✎ Modifier</button>
          <button class="link-action link-danger" data-act="del-eq">🗑 Supprimer</button>
        </div>
      </div>
      <div class="detail-tags">
        <span class="tag tag-type">${typeEmoji(eq.type)} ${esc(eq.type)}</span>
        ${eq.lieu ? `<span class="tag tag-place">📍 ${esc(eq.lieu)}</span>` : ""}
        ${st === "panne" ? `<span class="tag tag-cat-poubelle">● En panne</span>` : ""}
      </div>

      <div class="photo-strip">
        ${photos}
        <button class="photo-add" data-act="add-photo">＋</button>
      </div>

      <div class="tabs">
        ${tabBtn("carnet", "📖 Carnet")}
        ${tabBtn("planification", "🗓 Planification")}
        ${tabBtn("contacts", "👥 Contacts")}
        ${tabBtn("documents", "📎 Documents")}
        ${tabBtn("informations", "ℹ️ Informations")}
      </div>
      <div id="tab-content"></div>
    `;
    app.innerHTML = html;
    renderTab(eq);
  }

  function tabBtn(id, label) {
    return `<button class="tab ${view.tab === id ? "active" : ""}" data-tab="${id}">${label}</button>`;
  }

  function renderTab(eq) {
    const c = document.getElementById("tab-content");
    if (view.tab === "carnet") c.innerHTML = tabCarnet(eq);
    else if (view.tab === "planification") c.innerHTML = tabPlanif(eq);
    else if (view.tab === "contacts") c.innerHTML = tabContacts(eq);
    else if (view.tab === "documents") c.innerHTML = tabDocs(eq);
    else c.innerHTML = tabInfos(eq);
  }

  /* ---- Onglet Carnet ---- */
  function tabCarnet(eq) {
    const items = (eq.carnet || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    let body;
    if (items.length === 0) {
      body = `<div class="empty"><div class="em-ico">📖</div><h3>Carnet vide</h3><p>Ajoutez les étapes de vie de l'équipement : achat, maintenance, réparation…</p></div>`;
    } else {
      const byYear = {};
      items.forEach(it => { const y = (it.date || "????").slice(0, 4); (byYear[y] = byYear[y] || []).push(it); });
      const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));
      body = years.map(y => `
        <div class="timeline-year">${y}</div>
        <div class="timeline">
          ${byYear[y].map(it => `
            <div class="tl-item">
              <div class="tl-card" data-toggle-carnet="${it.id}">
                <div class="tl-row">
                  <span class="tl-date">${fmtDate(it.date)}</span>
                  <span class="tag tag-cat-${catKey(it.categorie)}">${esc(it.categorie)}</span>
                  <span class="tl-desc">${esc(it.description)}</span>
                  ${it.montant ? `<span class="tl-amount">${fmtMoney(it.montant)}</span>` : ""}
                  ${it.contact ? `<span class="tl-contact">${esc(it.contact)}</span>` : ""}
                </div>
                <div class="tl-detail">
                  ${it.detail ? esc(it.detail) + "<br>" : ""}
                  <div class="tl-actions">
                    <button class="link-action" data-edit-carnet="${it.id}">✎ Modifier</button>
                    <button class="link-action link-danger" data-del-carnet="${it.id}">🗑 Supprimer</button>
                  </div>
                </div>
              </div>
            </div>`).join("")}
        </div>`).join("");
    }
    return body + `<div class="section-add"><button class="btn-line" data-act="add-carnet">＋ Ajouter une intervention</button></div>`;
  }

  function catKey(cat) {
    return { "Achat": "achat", "Maintenance": "maintenance", "Réparation": "reparation", "Vente": "vente", "Poubelle": "poubelle" }[cat] || "maintenance";
  }
  function fmtMoney(v) {
    const n = parseFloat(String(v).replace(",", "."));
    if (isNaN(n)) return esc(v);
    return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }

  /* ---- Onglet Planification ---- */
  function tabPlanif(eq) {
    const regles = (eq.regles || []).slice().sort((a, b) => (a.echeance || "9999").localeCompare(b.echeance || "9999"));
    const contrats = eq.contrats || [];
    return `
      <div class="tab-block">
        <div class="tab-section-label">Règles de maintenance</div>
        ${regles.length ? regles.map(r => {
          const b = dueBadgeLong(r.echeance);
          const late = b.cls === "late";
          return `<div class="plain-card ${late ? "late" : "ok-bg"}">
            <div class="pc-icon ${late ? "red" : "green"}">${late ? "⚠" : "✔"}</div>
            <div class="pc-body">
              <div class="pc-title">${esc(r.nom)}</div>
              <div class="pc-meta">${esc(r.frequence)} · Échéance : ${fmtDate(r.echeance)}${r.contact ? " · " + esc(r.contact) : ""}</div>
            </div>
            <div class="pc-actions">
              ${badgeHTML(b)}
              <button class="icon-btn" data-edit-regle="${r.id}">✎</button>
              <button class="icon-btn del" data-del-regle="${r.id}">🗑</button>
            </div>
          </div>`;
        }).join("") : `<p class="pc-meta" style="margin-bottom:10px">Aucune règle pour le moment.</p>`}
        <button class="btn-line" data-act="add-regle">＋ Ajouter une règle</button>
      </div>

      <div class="tab-block">
        <div class="tab-section-label">Échéances contractuelles</div>
        ${contrats.length ? contrats.map(ct => {
          const b = dueBadgeLong(ct.echeance);
          return `<div class="plain-card ${b.cls === "late" ? "late" : ""}">
            <div class="pc-icon ${b.cls === "late" ? "red" : b.cls === "warn" ? "amber" : "green"}">${ct.echeance ? "⏳" : "📅"}</div>
            <div class="pc-body">
              <div class="pc-title">${esc(ct.type)}</div>
              <div class="pc-meta">${ct.echeance ? "Échéance : " + fmtDate(ct.echeance) : "Aucune date renseignée"}</div>
            </div>
            <div class="pc-actions">
              ${badgeHTML(b)}
              <button class="icon-btn" data-edit-contrat="${ct.id}">✎</button>
              <button class="icon-btn del" data-del-contrat="${ct.id}">🗑</button>
            </div>
          </div>`;
        }).join("") : `<p class="pc-meta" style="margin-bottom:10px">Aucune échéance.</p>`}
        <button class="btn-line" data-act="add-contrat">＋ Ajouter une échéance</button>
      </div>`;
  }

  /* ---- Onglet Contacts ---- */
  function tabContacts(eq) {
    const cs = eqContacts(eq);
    return `
      ${cs.length ? cs.map(ct => `
        <div class="plain-card contact-card">
          <div class="pc-icon">👤</div>
          <div class="pc-body">
            <div class="pc-title">${esc(ct.nom)} ${ct.role ? `<span class="tag tag-role" style="margin-left:6px">${esc(ct.role)}</span>` : ""}</div>
            <div class="pc-meta">${contactMeta(ct)}${ct.categorie ? ((ct.tel || ct.email) ? " · " : "") + "📂 " + esc(ct.categorie) : ""}</div>
          </div>
          <div class="pc-actions">
            <button class="icon-btn" data-edit-contact="${ct.id}" title="Modifier (dans le répertoire)">✎</button>
            <button class="icon-btn del" data-detach-contact="${ct.id}" title="Retirer de cet équipement">✕</button>
          </div>
        </div>`).join("") : `<div class="empty"><div class="em-ico">👥</div><h3>Aucun contact</h3><p>Ajoutez un contact du répertoire, ou créez-en un nouveau.</p></div>`}
      <div class="section-add"><button class="btn-line" data-act="add-contact">＋ Ajouter un contact</button></div>`;
  }

  /* ---- Onglet Documents ---- */
  function tabDocs(eq) {
    const docs = eq.documents || [];
    return `
      ${docs.length ? `<div class="doc-grid">${docs.map(dc => {
        const isImg = dc.kind === "image" && dc.data;      // ancien format : image intégrée
        const target = dc.lien || dc.url || dc.data;       // lien externe ou fichier
        const thumb = isImg
          ? `<img class="doc-thumb" src="${dc.data}" data-lightbox-doc="${dc.id}" alt="">`
          : `<div class="doc-thumb" data-open-doc="${dc.id}">${dc.lien ? "🔗" : "📄"}</div>`;
        return `<div class="doc-card">
          <button class="doc-del" data-del-doc="${dc.id}">🗑</button>
          ${thumb}
          <div class="doc-info">
            <div class="doc-name">${esc(dc.nom)}</div>
            <div class="doc-sub"><span>${esc(dc.type || "Document")}</span><span>${fmtDate(dc.date)}</span></div>
            ${target ? `<button class="link-action" data-open-doc="${dc.id}" style="margin-top:6px;padding:0">Ouvrir ↗</button>` : ""}
          </div>
        </div>`;
      }).join("")}</div>` : `<div class="empty"><div class="em-ico">📎</div><h3>Aucun document</h3><p>Ajoutez le lien vers vos factures, notices, certificats… (stockés sur votre Drive).</p></div>`}
      <div class="section-add"><button class="btn-line" data-act="add-doc">＋ Ajouter un document (lien)</button></div>`;
  }

  /* ---- Onglet Informations ---- */
  function tabInfos(eq) {
    const i = eq.infos || {};
    const cell = (k, v) => `<div class="info-cell"><div class="k">${esc(k)}</div><div class="v">${v ? esc(v) : "—"}</div></div>`;
    return `
      <div class="info-grid">
        ${cell("Nom", eq.nom)}
        ${cell("Type", eq.type)}
        ${cell("Marque", eq.marque)}
        ${cell("Modèle", eq.modele)}
        ${cell("Localisation", eq.lieu)}
        ${cell("N° de série", i.numeroSerie)}
        ${cell("Date d'achat", i.dateAchat ? fmtDate(i.dateAchat) : "")}
        ${cell("Prix d'achat", i.prixAchat ? fmtMoney(i.prixAchat) : "")}
      </div>
      ${i.notes ? `<div class="plain-card" style="margin-top:12px"><div class="pc-body"><div class="pc-meta" style="white-space:pre-wrap">${esc(i.notes)}</div></div></div>` : ""}
      <div class="section-add"><button class="btn-line" data-act="edit-eq">✎ Modifier les informations</button></div>`;
  }

  /* =========================================================
     MODALES / FORMULAIRES
     ========================================================= */
  const modalRoot = document.getElementById("modal-root");

  function openModal(title, bodyHTML, onSave, saveLabel) {
    modalRoot.innerHTML = `
      <div class="modal-overlay">
        <div class="modal" role="dialog">
          <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close">✕</button></div>
          <div class="modal-body">${bodyHTML}</div>
          <div class="modal-foot">
            <button class="btn btn-soft" data-cancel>Annuler</button>
            <button class="btn btn-primary" data-save>${esc(saveLabel || "Enregistrer")}</button>
          </div>
        </div>
      </div>`;
    const overlay = modalRoot.querySelector(".modal-overlay");
    const close = () => { modalRoot.innerHTML = ""; };
    overlay.querySelector(".modal-close").onclick = close;
    overlay.querySelector("[data-cancel]").onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    overlay.querySelector("[data-save]").onclick = () => {
      if (onSave(overlay) !== false) close();
    };
    const first = overlay.querySelector("input, select, textarea");
    if (first) first.focus();
    return overlay;
  }

  function val(overlay, name) { const el = overlay.querySelector(`[name="${name}"]`); return el ? el.value.trim() : ""; }

  function fieldText(name, label, value, opts) {
    opts = opts || {};
    return `<div class="field"><label>${esc(label)}</label><input type="${opts.type || "text"}" name="${name}" value="${esc(value || "")}" placeholder="${esc(opts.ph || "")}"></div>`;
  }
  function fieldSelect(name, label, value, options) {
    return `<div class="field"><label>${esc(label)}</label><select name="${name}">${options.map(o => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`;
  }
  function fieldArea(name, label, value) {
    return `<div class="field"><label>${esc(label)}</label><textarea name="${name}">${esc(value || "")}</textarea></div>`;
  }

  /* ---- Nouvel / Éditer équipement ---- */
  function modalEquipement(eq) {
    const isNew = !eq;
    eq = eq || { nom: "", marque: "", modele: "", type: "Autre", lieu: "", statut: "ok", infos: {} };
    const i = eq.infos || {};
    const allTypes = [...new Set([...state.types, ...state.equipements.map(e => e.type)])];
    const body = `
      ${fieldText("nom", "Nom de l'équipement *", eq.nom, { ph: "Fauteuil dentaire KaVo…" })}
      <div class="field-row">
        ${fieldText("marque", "Marque", eq.marque, { ph: "KaVo" })}
        ${fieldText("modele", "Modèle", eq.modele, { ph: "Estetica E80" })}
      </div>
      <div class="field-row">
        <div class="field"><label>Type</label>
          <select name="type">${allTypes.map(t => `<option ${t === eq.type ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
          <div class="field-hint">Pour un nouveau type, tapez-le ci-dessous.</div>
        </div>
        ${fieldText("newtype", "Nouveau type", "", { ph: "ex. Compresseur" })}
      </div>
      <div class="field-row">
        ${fieldText("lieu", "Localisation", eq.lieu, { ph: "Salle 2, Stérilisation…" })}
        ${fieldSelect("statut", "État", eq.statut === "panne" ? "En panne" : eq.statut === "maintenance" ? "En maintenance" : "En service", ["En service", "En maintenance", "En panne"])}
      </div>
      <div class="field-row">
        ${fieldText("numeroSerie", "N° de série", i.numeroSerie)}
        ${fieldText("dateAchat", "Date d'achat", i.dateAchat, { type: "date" })}
      </div>
      ${fieldText("prixAchat", "Prix d'achat (€)", i.prixAchat, { type: "number" })}
      ${fieldArea("notes", "Notes", i.notes)}
    `;
    openModal(isNew ? "Nouvel équipement" : "Modifier l'équipement", body, (ov) => {
      const nom = val(ov, "nom");
      if (!nom) { toast("Le nom est obligatoire."); return false; }
      const newtype = val(ov, "newtype");
      const type = newtype || val(ov, "type");
      if (newtype && !state.types.includes(newtype)) state.types.push(newtype);
      const statutLabel = val(ov, "statut");
      const statut = statutLabel === "En panne" ? "panne" : statutLabel === "En maintenance" ? "maintenance" : "ok";
      const infos = {
        numeroSerie: val(ov, "numeroSerie"), dateAchat: val(ov, "dateAchat"),
        prixAchat: val(ov, "prixAchat"), notes: val(ov, "notes"),
      };
      if (isNew) {
        const nEq = { id: uid(), nom, marque: val(ov, "marque"), modele: val(ov, "modele"), type, lieu: val(ov, "lieu"), statut, photos: [], carnet: [], regles: [], contrats: [], contactIds: [], documents: [], infos };
        state.equipements.unshift(nEq);
        view = { ...view, name: "detail", id: nEq.id, tab: "carnet" };
      } else {
        Object.assign(eq, { nom, marque: val(ov, "marque"), modele: val(ov, "modele"), type, lieu: val(ov, "lieu"), statut, infos });
      }
      save(); render();
    }, isNew ? "Créer" : "Enregistrer");
  }

  /* ---- Carnet ---- */
  function modalCarnet(eq, item) {
    const isNew = !item;
    item = item || { date: new Date().toISOString().slice(0, 10), categorie: "Maintenance", description: "", montant: "", contact: "", detail: "" };
    const contactNames = (state.repertoire || []).map(c => c.nom);
    const body = `
      <div class="field-row">
        ${fieldText("date", "Date", item.date, { type: "date" })}
        ${fieldSelect("categorie", "Catégorie", item.categorie, CARNET_CATS)}
      </div>
      ${fieldText("description", "Description *", item.description, { ph: "Révision annuelle complète" })}
      <div class="field-row">
        ${fieldText("montant", "Montant (€)", item.montant, { type: "number" })}
        <div class="field"><label>Contact / Prestataire</label>
          <input type="text" name="contact" value="${esc(item.contact)}" list="contactlist" placeholder="Prestataire">
          <datalist id="contactlist">${contactNames.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
        </div>
      </div>
      ${fieldArea("detail", "Détails (optionnel)", item.detail)}
    `;
    openModal(isNew ? "Ajouter une intervention" : "Modifier l'intervention", body, (ov) => {
      const description = val(ov, "description");
      if (!description) { toast("La description est obligatoire."); return false; }
      const data = { date: val(ov, "date"), categorie: val(ov, "categorie"), description, montant: val(ov, "montant"), contact: val(ov, "contact"), detail: val(ov, "detail") };
      if (isNew) { eq.carnet.push({ id: uid(), ...data }); }
      else { Object.assign(item, data); }
      save(); renderTab(eq);
    });
  }

  /* ---- Règle de maintenance ---- */
  function modalRegle(eq, rule) {
    const isNew = !rule;
    rule = rule || { nom: "", frequence: "Annuel", echeance: "", contact: "" };
    const contactNames = (state.repertoire || []).map(c => c.nom);
    const body = `
      ${fieldText("nom", "Intitulé de la règle *", rule.nom, { ph: "Révision annuelle" })}
      <div class="field-row">
        ${fieldSelect("frequence", "Fréquence", rule.frequence, FREQUENCES)}
        ${fieldText("echeance", "Prochaine échéance", rule.echeance, { type: "date" })}
      </div>
      <div class="field"><label>Contact / Prestataire</label>
        <input type="text" name="contact" value="${esc(rule.contact)}" list="contactlist2" placeholder="Prestataire">
        <datalist id="contactlist2">${contactNames.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
      </div>
    `;
    openModal(isNew ? "Ajouter une règle" : "Modifier la règle", body, (ov) => {
      const nom = val(ov, "nom");
      if (!nom) { toast("L'intitulé est obligatoire."); return false; }
      const data = { nom, frequence: val(ov, "frequence"), echeance: val(ov, "echeance"), contact: val(ov, "contact") };
      if (isNew) { eq.regles.push({ id: uid(), ...data }); }
      else { Object.assign(rule, data); }
      save(); renderTab(eq);
    });
  }

  /* ---- Échéance contractuelle ---- */
  function modalContrat(eq, ct) {
    const isNew = !ct;
    ct = ct || { type: "Fin de garantie", echeance: "" };
    const body = `
      <div class="field"><label>Type d'échéance</label>
        <input type="text" name="type" value="${esc(ct.type)}" list="contratlist" placeholder="Fin de garantie">
        <datalist id="contratlist">${CONTRAT_TYPES.map(t => `<option value="${esc(t)}">`).join("")}</datalist>
      </div>
      ${fieldText("echeance", "Date d'échéance", ct.echeance, { type: "date" })}
    `;
    openModal(isNew ? "Ajouter une échéance" : "Modifier l'échéance", body, (ov) => {
      const type = val(ov, "type");
      if (!type) { toast("Le type est obligatoire."); return false; }
      const data = { type, echeance: val(ov, "echeance") };
      if (isNew) { eq.contrats.push({ id: uid(), ...data }); }
      else { Object.assign(ct, data); }
      save(); renderTab(eq);
    });
  }

  /* ---- Contact : rattacher (depuis le répertoire) ou créer ---- */
  function modalAttachContact(eq) {
    const available = (state.repertoire || []).filter(c => !(eq.contactIds || []).includes(c.id))
      .sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
    const body = `
      ${available.length ? `
        <div class="tab-section-label" style="margin-top:0">Choisir dans le répertoire</div>
        <div class="rep-pick-list">
          ${available.map(c => `<label class="rep-pick">
            <input type="checkbox" value="${c.id}">
            <span><strong>${esc(c.nom)}</strong>${c.role ? ` <span class="tag tag-role">${esc(c.role)}</span>` : ""}${c.tel ? ` · ${esc(c.tel)}` : ""}</span>
          </label>`).join("")}
        </div>` : `<p class="pc-meta">Le répertoire est vide (ou tous ses contacts sont déjà rattachés).</p>`}
      <div class="rep-or">— ou —</div>
      <button type="button" class="btn-line" id="new-contact-btn">＋ Créer un nouveau contact</button>
    `;
    const ov = openModal("Ajouter un contact", body, (ov) => {
      const ids = Array.from(ov.querySelectorAll(".rep-pick input:checked")).map(i => i.value);
      if (!ids.length) { toast("Cochez un contact, ou créez-en un nouveau."); return false; }
      ids.forEach(id => { if (!eq.contactIds.includes(id)) eq.contactIds.push(id); });
      save(); renderTab(eq);
    }, "Rattacher");
    ov.querySelector("#new-contact-btn").onclick = () => { modalRoot.innerHTML = ""; modalEditContact(null, eq); };
  }

  // Construit un <select> avec les options + une entrée « ＋ Nouveau… » (sentinelle __new__).
  // includeEmpty : ajoute une option vide « — Aucune — » en tête.
  function selectAdd(name, label, current, options, newLabel, includeEmpty) {
    const opts = options.slice();
    if (current && !opts.includes(current)) opts.unshift(current); // conserve la valeur actuelle même si retirée de la liste
    return `<div class="field"><label>${esc(label)}</label>
      <select name="${name}">
        ${includeEmpty ? `<option value="" ${!current ? "selected" : ""}>— Aucune —</option>` : ""}
        ${opts.map(o => `<option ${o === current ? "selected" : ""}>${esc(o)}</option>`).join("")}
        <option value="__new__">${esc(newLabel)}</option>
      </select></div>`;
  }

  // Créer / modifier un contact DU RÉPERTOIRE. attachEq : rattache aussi à cet équipement.
  function modalEditContact(ct, attachEq) {
    const isNew = !ct;
    ct = ct || { nom: "", role: "SAV", categorie: "", tel: "", email: "" };
    const body = `
      ${fieldText("nom", "Nom / Société *", ct.nom, { ph: "KaVo Kerr France" })}
      <div class="field-row">
        ${selectAdd("role", "Rôle", ct.role, state.contactRoles, "＋ Nouveau rôle…", false)}
        ${selectAdd("categorie", "Catégorie", ct.categorie || "", state.contactCategories, "＋ Nouvelle catégorie…", true)}
      </div>
      <div class="field-row">
        ${fieldText("tel", "Téléphone", ct.tel, { type: "tel" })}
        ${fieldText("email", "Email", ct.email, { type: "email" })}
      </div>
    `;
    const ov = openModal(isNew ? "Nouveau contact" : "Modifier le contact", body, (ov) => {
      const nom = val(ov, "nom");
      if (!nom) { toast("Le nom est obligatoire."); return false; }
      const data = { nom, role: val(ov, "role"), categorie: val(ov, "categorie"), tel: val(ov, "tel"), email: val(ov, "email") };
      if (data.role === "__new__") data.role = ""; if (data.categorie === "__new__") data.categorie = "";
      if (isNew) {
        const id = uid();
        state.repertoire.push({ id, ...data });
        if (attachEq && !attachEq.contactIds.includes(id)) attachEq.contactIds.push(id);
      } else { Object.assign(ct, data); }
      save();
      if (view.name === "detail") renderTab(getEq(view.id));
      else renderRepertoire();
    });
    wireAddSelect(ov.querySelector("[name=role]"), state.contactRoles, "Nom du nouveau rôle :");
    wireAddSelect(ov.querySelector("[name=categorie]"), state.contactCategories, "Nom de la nouvelle catégorie :");
  }

  // Gère l'option « ＋ Nouveau… » d'un select : demande le nom, l'ajoute à la liste et le sélectionne.
  function wireAddSelect(sel, list, promptMsg) {
    if (!sel) return;
    sel.dataset.prev = sel.value;
    sel.onchange = () => {
      if (sel.value === "__new__") {
        const v = (prompt(promptMsg) || "").trim();
        if (v) {
          if (!list.includes(v)) list.push(v);
          const opt = document.createElement("option"); opt.textContent = v; opt.value = v;
          sel.insertBefore(opt, sel.querySelector('option[value="__new__"]'));
          sel.value = v;
        } else { sel.value = sel.dataset.prev || ""; }
      }
      sel.dataset.prev = sel.value;
    };
  }

  // Gérer les listes de rôles et de catégories (ajouter / renommer / supprimer)
  function modalManageLists() {
    const rowsHTML = (items) => items.map(v => `
      <div class="list-edit-row" data-orig="${esc(v)}">
        <input class="le-input" value="${esc(v)}">
        <button type="button" class="le-del" title="Supprimer">🗑</button>
      </div>`).join("");
    const body = `
      <div class="tab-section-label" style="margin-top:0">Rôles</div>
      <div id="roles-list">${rowsHTML(state.contactRoles)}</div>
      <button type="button" class="btn-line" id="add-role" style="margin-bottom:4px">＋ Ajouter un rôle</button>
      <div class="tab-section-label" style="margin-top:18px">Catégories</div>
      <div id="cats-list">${rowsHTML(state.contactCategories)}</div>
      <button type="button" class="btn-line" id="add-cat">＋ Ajouter une catégorie</button>
      <p class="field-hint" style="margin-top:12px">Renommer un élément met à jour tous les contacts concernés. Supprimer un élément ne supprime pas les contacts.</p>
    `;
    const ov = openModal("Rôles & catégories", body, (ov) => {
      const collect = (sel) => {
        const newList = [], renameMap = {};
        ov.querySelectorAll(sel + " .list-edit-row").forEach(r => {
          const orig = r.dataset.orig, nv = r.querySelector("input").value.trim();
          if (nv && !newList.includes(nv)) { newList.push(nv); if (orig && orig !== nv) renameMap[orig] = nv; }
        });
        return { newList, renameMap };
      };
      const roles = collect("#roles-list"), cats = collect("#cats-list");
      if (!roles.newList.length) { toast("Gardez au moins un rôle."); return false; }
      state.contactRoles = roles.newList;
      state.contactCategories = cats.newList;
      (state.repertoire || []).forEach(c => {
        if (c.role && roles.renameMap[c.role]) c.role = roles.renameMap[c.role];
        if (c.categorie && cats.renameMap[c.categorie]) c.categorie = cats.renameMap[c.categorie];
      });
      save(); renderRepertoire();
    }, "Enregistrer");

    const addRow = (containerId) => {
      const div = document.createElement("div");
      div.className = "list-edit-row"; div.dataset.orig = "";
      div.innerHTML = `<input class="le-input" value=""><button type="button" class="le-del" title="Supprimer">🗑</button>`;
      div.querySelector(".le-del").onclick = () => div.remove();
      ov.querySelector(containerId).appendChild(div);
      div.querySelector("input").focus();
    };
    ov.querySelector("#add-role").onclick = () => addRow("#roles-list");
    ov.querySelector("#add-cat").onclick = () => addRow("#cats-list");
    ov.querySelectorAll(".le-del").forEach(b => b.onclick = () => b.closest(".list-edit-row").remove());
  }

  /* =========================================================
     ÉVÉNEMENTS (délégation)
     ========================================================= */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-nav],[data-open],[data-act],[data-filter],[data-type],[data-tab],[data-toggle-carnet],[data-edit-carnet],[data-del-carnet],[data-edit-regle],[data-del-regle],[data-edit-contrat],[data-del-contrat],[data-edit-contact],[data-detach-contact],[data-edit-repertoire],[data-del-repertoire],[data-del-doc],[data-open-doc],[data-lightbox],[data-delphoto],[data-lightbox-doc]");
    if (!t) return;
    const eq = getEq(view.id);

    // Navigation
    if (t.dataset.nav === "list") { view = { ...view, name: "list", id: null }; return render(); }
    if (t.dataset.nav === "repertoire") { view = { ...view, name: "repertoire", id: null }; return render(); }
    if (t.dataset.open) { view = { ...view, name: "detail", id: t.dataset.open, tab: "carnet" }; return render(); }
    if (t.dataset.tab) { view.tab = t.dataset.tab; document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === view.tab)); return renderTab(eq); }
    if (t.dataset.filter) { view.filter = t.dataset.filter; return renderList(); }
    if (t.dataset.type !== undefined && t.classList.contains("type-chip")) { view.type = t.dataset.type || null; return renderList(); }

    // Photos
    if (t.dataset.lightbox !== undefined && eq) return lightbox(eq.photos[+t.dataset.lightbox]);
    if (t.dataset.delphoto !== undefined && eq) {
      if (confirm("Supprimer cette photo ?")) {
        eq.photos.splice(+t.dataset.delphoto, 1);
        save(); renderDetail();
      }
      return;
    }
    if (t.dataset.lightboxDoc && eq) { const dc = eq.documents.find(d => d.id === t.dataset.lightboxDoc); if (dc) lightbox(dc.data || dc.url); return; }
    if (t.dataset.openDoc && eq) { const dc = eq.documents.find(d => d.id === t.dataset.openDoc); const target = dc && (dc.lien || dc.url || dc.data); if (target) window.open(target, "_blank", "noopener"); return; }

    // Carnet
    if (t.dataset.toggleCarnet && !e.target.closest(".tl-actions")) { t.classList.toggle("open"); return; }
    if (t.dataset.editCarnet && eq) return modalCarnet(eq, eq.carnet.find(x => x.id === t.dataset.editCarnet));
    if (t.dataset.delCarnet && eq) { if (confirm("Supprimer cette intervention ?")) { eq.carnet = eq.carnet.filter(x => x.id !== t.dataset.delCarnet); save(); renderTab(eq); } return; }

    // Règles
    if (t.dataset.editRegle && eq) return modalRegle(eq, eq.regles.find(x => x.id === t.dataset.editRegle));
    if (t.dataset.delRegle && eq) { if (confirm("Supprimer cette règle ?")) { eq.regles = eq.regles.filter(x => x.id !== t.dataset.delRegle); save(); renderTab(eq); } return; }

    // Contrats
    if (t.dataset.editContrat && eq) return modalContrat(eq, eq.contrats.find(x => x.id === t.dataset.editContrat));
    if (t.dataset.delContrat && eq) { if (confirm("Supprimer cette échéance ?")) { eq.contrats = eq.contrats.filter(x => x.id !== t.dataset.delContrat); save(); renderTab(eq); } return; }

    // Contacts (rattachés à un équipement) — édition = modif du répertoire, retrait = détachement
    if (t.dataset.editContact) return modalEditContact(contactById(t.dataset.editContact));
    if (t.dataset.detachContact && eq) { eq.contactIds = (eq.contactIds || []).filter(id => id !== t.dataset.detachContact); save(); renderTab(eq); return; }

    // Répertoire
    if (t.dataset.editRepertoire) return modalEditContact(contactById(t.dataset.editRepertoire));
    if (t.dataset.delRepertoire) {
      const c = contactById(t.dataset.delRepertoire); if (!c) return;
      const used = equipmentsUsing(c.id);
      const msg = used.length
        ? "« " + c.nom + " » est rattaché à " + used.length + " équipement(s). Le supprimer du répertoire le retirera aussi de ces équipements. Continuer ?"
        : "Supprimer « " + c.nom + " » du répertoire ?";
      if (confirm(msg)) {
        state.equipements.forEach(eq2 => { eq2.contactIds = (eq2.contactIds || []).filter(id => id !== c.id); });
        state.repertoire = state.repertoire.filter(x => x.id !== c.id);
        save(); renderRepertoire();
      }
      return;
    }

    // Documents
    if (t.dataset.delDoc && eq) {
      if (confirm("Supprimer ce document ? (le fichier sur votre Drive n'est pas supprimé)")) {
        eq.documents = eq.documents.filter(x => x.id !== t.dataset.delDoc);
        save(); renderTab(eq);
      }
      return;
    }

    // Actions
    switch (t.dataset.act) {
      case "new-eq": return modalEquipement(null);
      case "edit-eq": return modalEquipement(eq);
      case "del-eq":
        if (eq && confirm("Supprimer définitivement « " + eq.nom + " » et tout son historique ?")) {
          state.equipements = state.equipements.filter(x => x.id !== eq.id);
          save(); view = { ...view, name: "list", id: null }; render();
        }
        return;
      case "add-photo": return pickFile("image/*", true, async (files) => {
        for (const f of files) {
          const dataUrl = await readImageCompressed(f, 900, 0.68); // compressée, stockée dans la base (sans Storage)
          eq.photos.push(dataUrl);
        }
        save(); renderDetail(); toast(files.length > 1 ? "Photos ajoutées." : "Photo ajoutée.");
      });
      case "add-carnet": return modalCarnet(eq, null);
      case "add-regle": return modalRegle(eq, null);
      case "add-contrat": return modalContrat(eq, null);
      case "add-contact": return modalAttachContact(eq);
      case "add-doc": return addDocument(eq);
      case "new-repertoire": return modalEditContact(null);
      case "manage-lists": return modalManageLists();
    }
  });

  /* ---- Ajout de document (par lien : Drive, etc.) ---- */
  function addDocument(eq) {
    const body = `
      ${fieldText("nom", "Nom du document *", "", { ph: "Facture, notice, certificat de conformité…" })}
      ${fieldText("lien", "Lien vers le document *", "", { ph: "https://drive.google.com/…" })}
      <div class="field-hint">Déposez le fichier sur votre Drive (cybeledent@gmail.com), copiez le <strong>lien de partage</strong> et collez-le ici. Un clic l'ouvrira. Pensez à autoriser l'accès dans le partage Drive.</div>
    `;
    openModal("Ajouter un document", body, (ov) => {
      const nom = val(ov, "nom");
      let lien = val(ov, "lien");
      if (!nom) { toast("Le nom est obligatoire."); return false; }
      if (!lien) { toast("Le lien est obligatoire."); return false; }
      if (!/^https?:\/\//i.test(lien)) lien = "https://" + lien;
      eq.documents.push({ id: uid(), nom, type: "Lien", kind: "lien", lien, date: new Date().toISOString().slice(0, 10) });
      save(); renderTab(eq); toast("Document ajouté.");
    }, "Ajouter");
  }

  function fileToDataURL(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }

  function pickFile(accept, multiple, cb) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = accept; inp.multiple = !!multiple;
    inp.onchange = () => { if (inp.files.length) cb(Array.from(inp.files)); };
    inp.click();
  }

  /* ---- Lightbox ---- */
  function lightbox(src) {
    if (!src) return;
    const lb = document.createElement("div");
    lb.className = "lightbox";
    lb.innerHTML = `<button class="lightbox-close">✕</button><img src="${src}" alt="">`;
    lb.onclick = () => lb.remove();
    document.body.appendChild(lb);
  }

  /* ---- Toast ---- */
  let toastTimer;
  function toast(msg) {
    clearTimeout(toastTimer);
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    toastTimer = setTimeout(() => el.remove(), 2600);
  }

  /* =========================================================
     ENREGISTREMENT DANS LE SHELL (sauvegarde combinée + aide gérées globalement)
     ========================================================= */
  if (window.CybeleShell) {
    window.CybeleShell.register("equipements", {
      label: "Équipements",
      getState: () => state,
      setState: (s) => {
        if (!s || !Array.isArray(s.equipements)) return false;
        state = normalize(s);
        save();
        view = { name: "list", id: null, tab: "carnet", search: "", filter: "all", type: null };
        render();
        return true;
      },
      onShow: () => render(),
    });
  }

  /* ---- Lancement ---- */
  async function init() {
    app.innerHTML = '<div style="text-align:center;padding:80px 20px;color:var(--muted);font-size:1.1rem">⏳ Chargement…</div>';
    // Attendre la connexion (sécurité) avant tout accès aux données cloud
    if (window.CybeleAuth) { try { await window.CybeleAuth.whenReady(); } catch (e) {} }
    const local = loadLocal();
    if (window.CybeleDB) {
      try {
        const cloud = await Promise.race([
          window.CybeleDB.load("equipements"),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 6000))
        ]);
        if (cloud) {
          state = cloud;
          try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
        } else {
          state = local || seed();
          if (!local) save(); // premier enregistrement cloud
        }
      } catch (e) {
        state = local || seed();
      }
    } else {
      state = local || seed();
    }
    state = normalize(state);
    render();
  }
  init();
})();
