/* =========================================================
   CybèleGestion — Shell multi-modules
   - bascule entre modules (Équipements / Personnel)
   - sauvegarde/restauration combinée de TOUS les modules
   - aide globale
   ========================================================= */
(function () {
  "use strict";

  const BACKUP_TAG = "cybelegestion-backup";
  const modules = {};        // id -> { label, getState, setState, onShow }
  let active = document.body.dataset.module || "equipements";

  const Shell = {
    register(id, api) {
      modules[id] = api;
    },
    switchTo(id) {
      if (!modules[id] && id !== "equipements" && id !== "personnel") return;
      active = id;
      document.body.dataset.module = id;
      document.querySelectorAll(".module-tab").forEach(t =>
        t.classList.toggle("active", t.dataset.moduleTab === id));
      document.querySelectorAll(".module-panel").forEach(p =>
        p.hidden = (p.dataset.modulePanel !== id));
      const m = modules[id];
      if (m && typeof m.onShow === "function") m.onShow();
      window.scrollTo(0, 0);
    },
    activeModule() { return active; },
  };
  window.CybeleShell = Shell;

  /* ---- Bascule de module ---- */
  document.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-module-tab]");
    if (tab) { Shell.switchTo(tab.dataset.moduleTab); return; }
  });
  const brand = document.getElementById("brand-home");
  if (brand) brand.onclick = (e) => { e.preventDefault(); Shell.switchTo(active); };

  /* =========================================================
     SAUVEGARDE / RESTAURATION COMBINÉE
     ========================================================= */
  document.getElementById("btn-export").onclick = () => {
    const data = { app: BACKUP_TAG, version: 1, date: new Date().toISOString(), modules: {} };
    Object.keys(modules).forEach(id => {
      try { data.modules[id] = modules[id].getState(); } catch (e) { /* ignore */ }
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cybelegestion-sauvegarde-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    flash("Sauvegarde téléchargée (tous les modules).");
  };

  document.getElementById("btn-import").onclick = () => document.getElementById("import-file").click();
  document.getElementById("import-file").onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        let payloads = {};
        if (data && data.app === BACKUP_TAG && data.modules) {
          payloads = data.modules;                       // nouvelle sauvegarde combinée
        } else if (data && Array.isArray(data.equipements)) {
          payloads = { equipements: data };              // ancienne sauvegarde équipements seule
        } else {
          throw new Error("format");
        }
        if (!confirm("Remplacer les données actuelles par cette sauvegarde ?")) return;
        let ok = 0;
        Object.keys(payloads).forEach(id => {
          if (modules[id] && modules[id].setState(payloads[id]) !== false) ok++;
        });
        flash(ok ? "Sauvegarde restaurée." : "Aucune donnée compatible dans ce fichier.");
      } catch (err) { flash("Fichier de sauvegarde invalide."); }
    };
    r.readAsText(f);
    e.target.value = "";
  };

  /* =========================================================
     AIDE GLOBALE
     ========================================================= */
  document.getElementById("btn-help").onclick = () => {
    const modalRoot = document.getElementById("modal-root");
    modalRoot.innerHTML = `
      <div class="modal-overlay">
        <div class="modal" role="dialog">
          <div class="modal-head"><h3>Aide — CybèleGestion</h3><button class="modal-close">✕</button></div>
          <div class="modal-body">
            <p style="margin-bottom:12px">CybèleGestion regroupe les outils de gestion du cabinet :</p>
            <ul style="margin:0 0 12px 18px; color:var(--muted); line-height:1.9">
              <li><strong>🔧 Équipements</strong> : inventaire, maintenance, garanties, documents.</li>
              <li><strong>👥 Personnel</strong> : planning, badgeuse, congés, heures, export paie.</li>
            </ul>
            <p style="background:var(--coral-light);padding:12px;border-radius:10px;font-size:.9rem">
              💾 <strong>Important</strong> : les données sont enregistrées sur <em>cet appareil</em>.
              Cliquez <strong>Sauvegarde</strong> régulièrement (un seul fichier contient tous les modules),
              et <strong>Restaurer</strong> pour les recharger ou les transférer sur un autre appareil.
            </p>
          </div>
          <div class="modal-foot"><button class="btn btn-primary" data-close style="flex:1;justify-content:center">Compris</button></div>
        </div>
      </div>`;
    const close = () => { modalRoot.innerHTML = ""; };
    modalRoot.querySelector(".modal-close").onclick = close;
    modalRoot.querySelector("[data-close]").onclick = close;
    modalRoot.querySelector(".modal-overlay").onclick = (ev) => { if (ev.target === ev.currentTarget) close(); };
  };

  /* ---- petit toast partagé ---- */
  let t;
  function flash(msg) {
    clearTimeout(t);
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    t = setTimeout(() => el.remove(), 2600);
  }
  Shell.flash = flash;
})();
