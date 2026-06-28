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
  const CONTACT_ROLES = ["SAV", "Réparateur", "Fournisseur", "Installateur", "Autre"];

  /* =========================================================
     ÉTAT
     ========================================================= */
  let state = load();
  let view = { name: "list", id: null, tab: "carnet", search: "", filter: "all", type: null };

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return seed();
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("⚠ Mémoire pleine : pensez à réduire le nombre de photos ou à faire une sauvegarde.");
    }
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

  function cardHTML(eq) {
    const st = equipState(eq);
    const stClass = st === "panne" ? "s-panne" : st === "maint" ? "s-maint" : "";
    const rule = nextRule(eq);
    const garantie = (eq.contrats || []).find(c => c.type === "Fin de garantie");
    const mainContact = (eq.contacts || [])[0];
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
    const cs = eq.contacts || [];
    return `
      ${cs.length ? cs.map(ct => `
        <div class="plain-card contact-card">
          <div class="pc-icon">👤</div>
          <div class="pc-body">
            <div class="pc-title">${esc(ct.nom)} ${ct.role ? `<span class="tag tag-role" style="margin-left:6px">${esc(ct.role)}</span>` : ""}</div>
            <div class="pc-meta">${ct.tel ? "📞 " + esc(ct.tel) : ""}${ct.tel && ct.email ? "&nbsp;&nbsp;" : ""}${ct.email ? "✉ " + esc(ct.email) : ""}</div>
          </div>
          <div class="pc-actions">
            <button class="icon-btn" data-edit-contact="${ct.id}">✎</button>
            <button class="icon-btn del" data-del-contact="${ct.id}">🗑</button>
          </div>
        </div>`).join("") : `<div class="empty"><div class="em-ico">👥</div><h3>Aucun contact</h3><p>Ajoutez les contacts liés à cet équipement (SAV, réparateur, fournisseur…).</p></div>`}
      <div class="section-add"><button class="btn-line" data-act="add-contact">＋ Ajouter un contact</button></div>`;
  }

  /* ---- Onglet Documents ---- */
  function tabDocs(eq) {
    const docs = eq.documents || [];
    return `
      ${docs.length ? `<div class="doc-grid">${docs.map(dc => `
        <div class="doc-card">
          <button class="doc-del" data-del-doc="${dc.id}">🗑</button>
          ${dc.data && dc.kind === "image"
            ? `<img class="doc-thumb" src="${dc.data}" data-lightbox-doc="${dc.id}" alt="">`
            : `<div class="doc-thumb" data-open-doc="${dc.id}">📄</div>`}
          <div class="doc-info">
            <div class="doc-name">${esc(dc.nom)}</div>
            <div class="doc-sub"><span>${esc(dc.type || "Document")}</span><span>${fmtDate(dc.date)}</span></div>
          </div>
        </div>`).join("")}</div>` : `<div class="empty"><div class="em-ico">📎</div><h3>Aucun document</h3><p>Ajoutez factures, notices, certificats, photos…</p></div>`}
      <div class="section-add"><button class="btn-line" data-act="add-doc">＋ Ajouter un document</button></div>`;
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
        const nEq = { id: uid(), nom, marque: val(ov, "marque"), modele: val(ov, "modele"), type, lieu: val(ov, "lieu"), statut, photos: [], carnet: [], regles: [], contrats: [], contacts: [], documents: [], infos };
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
    const contactNames = (eq.contacts || []).map(c => c.nom);
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
    const contactNames = (eq.contacts || []).map(c => c.nom);
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

  /* ---- Contact ---- */
  function modalContact(eq, ct) {
    const isNew = !ct;
    ct = ct || { nom: "", role: "SAV", tel: "", email: "" };
    const body = `
      ${fieldText("nom", "Nom / Société *", ct.nom, { ph: "KaVo Kerr France" })}
      ${fieldSelect("role", "Rôle", ct.role, CONTACT_ROLES)}
      <div class="field-row">
        ${fieldText("tel", "Téléphone", ct.tel, { type: "tel" })}
        ${fieldText("email", "Email", ct.email, { type: "email" })}
      </div>
    `;
    openModal(isNew ? "Ajouter un contact" : "Modifier le contact", body, (ov) => {
      const nom = val(ov, "nom");
      if (!nom) { toast("Le nom est obligatoire."); return false; }
      const data = { nom, role: val(ov, "role"), tel: val(ov, "tel"), email: val(ov, "email") };
      if (isNew) { eq.contacts.push({ id: uid(), ...data }); }
      else { Object.assign(ct, data); }
      save(); renderTab(eq);
    });
  }

  /* =========================================================
     ÉVÉNEMENTS (délégation)
     ========================================================= */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-nav],[data-open],[data-act],[data-filter],[data-type],[data-tab],[data-toggle-carnet],[data-edit-carnet],[data-del-carnet],[data-edit-regle],[data-del-regle],[data-edit-contrat],[data-del-contrat],[data-edit-contact],[data-del-contact],[data-del-doc],[data-lightbox],[data-delphoto],[data-lightbox-doc]");
    if (!t) return;
    const eq = getEq(view.id);

    // Navigation
    if (t.dataset.nav === "list") { view = { ...view, name: "list", id: null }; return render(); }
    if (t.dataset.open) { view = { ...view, name: "detail", id: t.dataset.open, tab: "carnet" }; return render(); }
    if (t.dataset.tab) { view.tab = t.dataset.tab; document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === view.tab)); return renderTab(eq); }
    if (t.dataset.filter) { view.filter = t.dataset.filter; return renderList(); }
    if (t.dataset.type !== undefined && t.classList.contains("type-chip")) { view.type = t.dataset.type || null; return renderList(); }

    // Photos
    if (t.dataset.lightbox !== undefined && eq) return lightbox(eq.photos[+t.dataset.lightbox]);
    if (t.dataset.delphoto !== undefined && eq) {
      if (confirm("Supprimer cette photo ?")) { eq.photos.splice(+t.dataset.delphoto, 1); save(); renderDetail(); }
      return;
    }
    if (t.dataset.lightboxDoc && eq) { const dc = eq.documents.find(d => d.id === t.dataset.lightboxDoc); if (dc) lightbox(dc.data); return; }

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

    // Contacts
    if (t.dataset.editContact && eq) return modalContact(eq, eq.contacts.find(x => x.id === t.dataset.editContact));
    if (t.dataset.delContact && eq) { if (confirm("Supprimer ce contact ?")) { eq.contacts = eq.contacts.filter(x => x.id !== t.dataset.delContact); save(); renderTab(eq); } return; }

    // Documents
    if (t.dataset.delDoc && eq) { if (confirm("Supprimer ce document ?")) { eq.documents = eq.documents.filter(x => x.id !== t.dataset.delDoc); save(); renderTab(eq); } return; }

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
        for (const f of files) { const data = await readImageCompressed(f, 1000, 0.72); eq.photos.push(data); }
        save(); renderDetail(); toast("Photo ajoutée.");
      });
      case "add-carnet": return modalCarnet(eq, null);
      case "add-regle": return modalRegle(eq, null);
      case "add-contrat": return modalContrat(eq, null);
      case "add-contact": return modalContact(eq, null);
      case "add-doc": return addDocument(eq);
    }
  });

  /* ---- Ajout de document ---- */
  function addDocument(eq) {
    pickFile("image/*,application/pdf", false, async (files) => {
      const f = files[0]; if (!f) return;
      const isImg = f.type.startsWith("image/");
      const nom = prompt("Nom du document :", f.name.replace(/\.[^.]+$/, "")) || f.name;
      try {
        let data;
        if (isImg) data = await readImageCompressed(f, 1400, 0.7);
        else { if (f.size > 1.5 * 1024 * 1024) { toast("PDF trop lourd (max ~1,5 Mo). Stockez plutôt le nom + une photo."); } data = await fileToDataURL(f); }
        eq.documents.push({ id: uid(), nom, type: isImg ? "Photo" : "PDF", kind: isImg ? "image" : "pdf", date: new Date().toISOString().slice(0, 10), data });
        save(); renderTab(eq); toast("Document ajouté.");
      } catch (err) { toast("Impossible d'ajouter ce fichier."); }
    });
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
        state = s;
        if (!state.types) state.types = DEFAULT_TYPES.slice();
        save();
        view = { name: "list", id: null, tab: "carnet", search: "", filter: "all", type: null };
        render();
        return true;
      },
      onShow: () => render(),
    });
  }

  /* ---- Lancement ---- */
  render();
})();
