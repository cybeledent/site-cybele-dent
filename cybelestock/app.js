/* =========================================================
   CybèleStock — Gestion du stock du cabinet dentaire
   Application indépendante.
   - Catégories → Produits (stock idéal / seuil mini)
   - Plusieurs références fournisseur par produit
   - Entrées/sorties par scan (Datamatrix GS1, code-barres)
     avec péremption + lot remplis automatiquement
   - Alertes péremption paramétrables
   - Liste de courses automatique + liens fournisseurs
   Données : localStorage (cache) + Firestore (synchronisation)
   ========================================================= */
(function () {
  "use strict";

  const STORE_KEY = "cybelestock-v1";
  const CLOUD_KEY = "cybelestock";
  const BACKUP_TAG = "cybelestock-backup";

  const app = document.getElementById("app");

  /* =========================================================
     ÉTAT
     ========================================================= */
  let state = null;
  let view = { name: "accueil", produitId: null, ficheTab: "stock", search: "" };
  const ico = (name, size) => (window.CybeleIcons ? window.CybeleIcons.ico(name, size) : "");
  const openCats = new Set(); // catégories dépliées (fermées par défaut)
  let cmdTab = "encours";       // sous-onglet de la vue Commandes
  let receptionCtx = null;      // { commandeId } pendant une réception par scan

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {
      toast("⚠ Mémoire locale pleine : faites une sauvegarde.");
    }
    if (window.CybeleDB) {
      window.CybeleDB.save(CLOUD_KEY, state).catch(() => {});
    }
  }

  /* =========================================================
     DONNÉES D'EXEMPLE (premier lancement)
     ========================================================= */
  function seed() {
    /* Données initiales : catalogue construit à partir des bons de
       commande d'août 2026 (Promodentaire, Doctor AI, CSADBOX,
       Dental Good Deal, Distrimed). Chaque produit est marqué
       « commandé — en attente de réception » ; le stock se remplira
       au fil des scans à la livraison. */
    const J21 = "2026-08-21", J09 = "2026-08-09";

    const cats = {}; const catList = [];
    [["GANTS", "Gants"], ["HYG", "Hygiène & désinfection"], ["STERIL", "Stérilisation"],
     ["ANESTH", "Anesthésie"], ["COMPO", "Composite & collage"], ["CIMENT", "Ciments & provisoire"],
     ["EMPR", "Empreintes"], ["ENDO", "Endodontie"], ["CHIR", "Chirurgie"],
     ["MATR", "Digue, matrices & polissage"], ["RADIO", "Radiologie & imagerie"],
     ["UU", "Usage unique"], ["MAT", "Matériel & instruments"], ["DIV", "Divers"]]
      .forEach(c => { const id = uid(); cats[c[0]] = id; catList.push({ id, name: c[1] }); });

    const fs = {}; const fList = [];
    [["PROMO", "Promodentaire", "https://www.promodentaire.com", "Franco de port dès 200 € — tél 01 49 63 35 35"],
     ["DAI", "Doctor AI", "https://www.doctor-ai.fr", "tél 01 84 74 00 24"],
     ["DGD", "Dental Good Deal", "https://www.dentalgooddeal.com", "tél 01 41 51 22 22"],
     ["DISTRI", "Distrimed", "https://www.distrimed.com", "Livraison 5,90 €, offerte dès 99 €"],
     ["CSAD", "CSADBOX", "", "Plateforme d'achats groupés — commandes réparties entre distributeurs (Promodentaire, Santelia, Septodont, Lohmann & Rauscher…)"],
     ["GACD", "GACD", "https://www.gacd.fr", ""],
     ["SCHEIN", "Henry Schein", "https://www.henryschein.fr", ""],
     ["MEGA", "Mega Dental", "https://www.megadental.fr", ""],
     ["DENTALTIX", "Dentaltix", "https://www.dentaltix.com/fr", ""]]
      .forEach(f => { const id = uid(); fs[f[0]] = id; fList.push({ id, name: f[1], url: f[2], note: f[3] }); });

    const produits = []; const commandes = {};
    // p(catégorie, nom, unité, qté commandée (= stock idéal), alerte péremption,
    //   date de commande, références [[fournisseur, réf, prix unitaire, désignation], …])
    function p(cat, name, unite, qty, alerte, date, refs) {
      const id = uid();
      produits.push({
        id, categorieId: cats[cat], name, unite,
        stockIdeal: qty, seuilMini: Math.floor(qty / 3),
        alertePeremption: !!alerte, delaiAlerteMois: 3, note: "",
        references: refs.map(r => ({
          id: uid(), fournisseurId: fs[r[0]], ref: r[1], prix: r[2],
          designation: r[3] || "", url: "", note: "", gtins: [],
        })),
        lots: [],
      });
      if (date) commandes[id] = { date };
    }

    /* ---- Promodentaire #5000031629 (21/08/2026) ---- */
    p("GANTS", "Gants latex Soft sans poudre — taille S (6/7)", "boîte", 20, false, J21, [["PROMO", "600481", "5,95", "Medibase — boîte de 100"]]);
    p("GANTS", "Gants latex Soft sans poudre — taille M (7/8)", "boîte", 20, false, J21, [["PROMO", "600482", "5,95", "Medibase — boîte de 100"]]);
    p("GANTS", "Gants nitrile Kentril non poudrés — taille M (7/8)", "boîte", 10, false, J21, [["PROMO", "950632", "4,90", "Kent Dental — boîte de 100"]]);
    p("HYG", "Serviettes 40x40 cm blanc 3 plis", "carton", 2, false, J21, [["PROMO", "600097", "59,00", "Medibase — carton de 1500"]]);
    p("HYG", "Essuie-mains en Z", "carton", 3, false, J21, [["PROMO", "600272", "35,00", "Medibase — 25 paquets de 150"]]);
    p("UU", "Compresses gaze stériles 5x5 cm 12 plis", "boîte", 3, false, J21, [["PROMO", "600421", "4,40", "Medibase"]]);
    p("ENDO", "Hypochlorite de sodium 2,5% (500 ml)", "flacon", 3, true, J21, [["PROMO", "950539", "8,50", "Kent Dental"]]);
    p("COMPO", "Gel de mordançage (etch)", "kit", 3, true, J21, [["PROMO", "950316", "10,00", "Kent — 4 seringues 1,2 ml + 12 embouts"]]);
    p("COMPO", "Composite Bulk Fill Flow Kent — A3", "seringue", 5, true, J21, [["PROMO", "950320", "16,00", "2 g + 10 embouts"]]);
    p("COMPO", "Composite Bulk Fill Flow Kent — A2", "seringue", 5, true, J21, [["PROMO", "950319", "16,00", "2 g + 10 embouts"]]);
    p("RADIO", "Protections capteur N°1", "boîte", 3, false, J21, [["PROMO", "600405", "8,50", "Medibase"]]);
    p("RADIO", "Protections capteur N°0", "boîte", 3, false, J21, [["PROMO", "600404", "8,50", "Medibase"]]);
    p("ANESTH", "Aiguilles 30G 0,30 x 12 mm", "boîte", 5, false, J21, [["PROMO", "600340", "5,90", "Medibase"]]);
    p("CHIR", "Éponges hémostatiques", "boîte", 2, true, J21, [["PROMO", "30506", "8,30", "Clinix — boîte de 20"]]);

    /* ---- Doctor AI n°35000005930 (09/08/2026) ---- */
    p("RADIO", "Plaques d'imagerie ERLM — taille 1", "lot", 1, false, J09, [["DAI", "398-9848", "398,90", "lot de 6"]]);

    /* ---- Doctor AI n°35000006167 (21/08/2026) ---- */
    p("RADIO", "Porte-films Emmenix-Flap", "boîte", 1, false, J21, [["DAI", "318-7398", "41,96", "boîte de 500"]]);
    p("DIV", "Cale-bouche Mirahold Block", "boîte", 1, false, J21, [["DAI", "098-9239", "11,19", "boîte de 6"]]);
    p("MATR", "Matrices Apis 25 mm", "boîte", 2, false, J21, [["DAI", "258-9666", "5,15", ""]]);
    p("MATR", "Coffret matrices Apis — prémolaires", "coffret", 1, false, J21, [["DAI", "258-9661", "12,66", ""]]);
    p("MATR", "Palodent V3 coins anatomiques — petit", "boîte", 1, false, J21, [["DAI", "628-9021", "36,53", "boîte de 100"]]);
    p("MATR", "Palodent V3 coins anatomiques — moyen", "boîte", 1, false, J21, [["DAI", "628-9022", "36,53", "boîte de 100"]]);
    p("MATR", "Pâte de polissage Clean Polish n°360", "tube", 1, false, J21, [["DAI", "228-7238", "9,73", ""]]);
    p("COMPO", "Adhésif 3M Scotchbond Universal", "flacon", 1, true, J21, [["DAI", "978-9001", "96,60", "réassort 5 ml"]]);
    p("COMPO", "Fuji II LC capsules — A3", "boîte", 1, true, J21, [["DAI", "618-6642", "123,00", "GC — 50 capsules"]]);
    p("MATR", "Wedjets (digue) — small jaune", "boîte", 1, false, J21, [["DAI", "325-4728", "23,78", "latex"]]);
    p("COMPO", "Fuji Triage capsules — blanc", "boîte", 1, true, J21, [["DAI", "208-9110", "121,70", "GC — 50 capsules"]]);
    p("CIMENT", "Provicol QM (ciment provisoire)", "kit", 2, true, J21, [["DAI", "738-8230", "38,73", "Voco — 1 seringue + 10 embouts"]]);
    p("UU", "Pompes à salive Monoart — bleu", "sachet", 2, false, J21, [["DAI", "898-9186", "2,15", "sachet de 100"]]);
    p("CIMENT", "Unifast Trad — liquide (100 ml)", "flacon", 1, true, J21, [["DAI", "408-0158", "36,80", "GC"]]);
    p("CIMENT", "Clearfil DC Core Plus — dentine", "kit", 2, true, J21, [["DAI", "218-9021", "118,63", "Kuraray"]]);
    p("EMPR", "Elite Glass recharge", "recharge", 2, true, J21, [["DAI", "448-9135", "41,78", "Zhermack"]]);
    p("CIMENT", "Protemp 4 — A3", "cartouche", 1, true, J21, [["DAI", "408-9136", "87,35", "3M"]]);

    /* ---- CSADBOX (21/08/2026, commande 2 254,23 €) ---- */
    p("CHIR", "Casaques chirurgicales stériles Sentinex Smart — M/L", "boîte", 1, false, J21, [["CSAD", "", "99,60", "Lohmann & Rauscher — 120 cm, x52"]]);
    p("CHIR", "Champs stériles de table Raucodrape 150x190", "boîte", 1, false, J21, [["CSAD", "", "23,04", "Lohmann & Rauscher — x15"]]);
    p("CHIR", "Champs stériles troués diam. 6 (50x60)", "boîte", 1, false, J21, [["CSAD", "", "26,88", "Lohmann & Rauscher — x70"]]);
    p("EMPR", "Alginate Anutex (500 g)", "boîte", 1, true, J21, [["CSAD", "", "9,85", "via Promodentaire"]]);
    p("MAT", "Réchauffeur de composites Filtek", "unité", 1, false, J21, [["CSAD", "", "", "offert (promo Solventum) — via Promodentaire"]]);
    p("EMPR", "Porte-empreintes Miratrays Mini", "boîte", 1, false, J21, [["CSAD", "", "20,80", "x50 — via Promodentaire"]]);
    p("COMPO", "MI Varnish unidoses", "pack", 1, true, J21, [["CSAD", "", "26,30", "GC — intro pack x10 — via Promodentaire"]]);
    p("ENDO", "Pointes gutta Isotaper N°30 28 mm — conicité 6%", "boîte", 1, false, J21, [["CSAD", "", "8,90", "x60 — via Promodentaire"]]);
    p("EMPR", "Bite trays droits Kent", "boîte", 1, false, J21, [["CSAD", "", "14,90", "x50 — via Promodentaire"]]);
    p("ENDO", "Ruban téflon Isotape (5 m)", "rouleau", 1, false, J21, [["CSAD", "", "7,36", "via Promodentaire"]]);
    p("CIMENT", "Telio CS Inlay (provisoire)", "coffret", 2, true, J21, [["CSAD", "", "52,30", "Ivoclar — 3x2,5 g universel — via Promodentaire"]]);
    p("CHIR", "Brosses chirurgicales stériles", "boîte", 1, false, J21, [["CSAD", "", "40,06", "x30 — via Promodentaire"]]);
    p("COMPO", "Composite Filtek Supreme XTE — C2", "seringue", 2, true, J21, [["CSAD", "", "53,65", "via Promodentaire"]]);
    p("ENDO", "Gutta condensors N°45 25 mm", "boîte", 2, false, J21, [["CSAD", "", "32,26", "x4 — via Promodentaire"]]);
    p("HYG", "Orotol Plus — désinfection aspiration (2,5 L)", "flacon", 1, false, J21, [["CSAD", "", "39,90", "Dürr Dental — via Promodentaire"]]);
    p("ENDO", "Pointes gutta Isotaper N°30 28 mm — conicité 4%", "boîte", 1, false, J21, [["CSAD", "", "8,90", "x60 — via Promodentaire"]]);
    p("COMPO", "Composite Filtek Easy Match Flow — natural", "coffret", 1, true, J21, [["CSAD", "", "72,46", "2 g x2 — via Promodentaire"]]);
    p("MAT", "Mini torch CI-AC-TORCH", "unité", 1, false, J21, [["CSAD", "", "54,00", "via Promodentaire"]]);
    p("CIMENT", "FujiCem 2 SL recharge (2x13,3 g)", "recharge", 1, true, J21, [["CSAD", "", "175,40", "GC — via Promodentaire"]]);
    p("CHIR", "Lames de bistouri N°15C", "boîte", 1, false, J21, [["CSAD", "", "15,90", "Swann Morton x100 — via Promodentaire"]]);
    p("MAT", "Recharge gaz Kisag", "recharge", 1, false, J21, [["CSAD", "", "11,86", "via Promodentaire"]]);
    p("COMPO", "Composite Filtek Supreme XTE — A2", "seringue", 4, true, J21, [["CSAD", "", "53,65", "via Promodentaire"]]);
    p("COMPO", "Composite Filtek Supreme XTE — translucide émail", "seringue", 1, true, J21, [["CSAD", "", "53,65", "via Promodentaire"]]);
    p("COMPO", "Composite Filtek Supreme XTE — A1 émail", "seringue", 1, true, J21, [["CSAD", "", "53,65", "via Promodentaire"]]);
    p("CIMENT", "F.I.T.T. coffret — teinte blanc", "coffret", 1, true, J21, [["CSAD", "", "49,90", "GC — via Promodentaire"]]);
    p("COMPO", "Composite Filtek Supreme XTE — A3", "seringue", 4, true, J21, [["CSAD", "", "53,65", "via Promodentaire"]]);
    p("CIMENT", "IRM coffret poudre/liquide", "coffret", 1, true, J21, [["CSAD", "", "49,90", "via Promodentaire"]]);
    p("COMPO", "Composite Filtek Supreme XTE — C3", "seringue", 1, true, J21, [["CSAD", "", "53,65", "via Promodentaire"]]);
    p("CHIR", "Lames de bistouri N°12", "boîte", 1, false, J21, [["CSAD", "", "15,90", "Swann Morton x100 — via Promodentaire"]]);
    p("COMPO", "Sealite Regular coffret (25 g)", "coffret", 2, true, J21, [["CSAD", "", "65,50", "via Promodentaire"]]);
    p("COMPO", "Composite Filtek Supreme XTE — A3,5", "seringue", 2, true, J21, [["CSAD", "", "53,65", "via Promodentaire"]]);
    p("UU", "Canules d'aspiration Baby Jet enfant — vert", "boîte", 1, false, J21, [["CSAD", "", "7,40", "diam. 16 mm x10 — via Santelia"]]);
    p("UU", "Canules d'aspiration chirurgicales stériles", "boîte", 1, false, J21, [["CSAD", "", "15,90", "x20 — via Santelia"]]);
    p("GANTS", "Gants chirurgie stériles latex Gammex — taille 7 (S/M)", "boîte", 1, false, J21, [["CSAD", "", "33,00", "Ansell — 50 paires — via Santelia"]]);
    p("GANTS", "Gants chirurgie stériles latex Gammex — taille 6,5 (S)", "boîte", 1, false, J21, [["CSAD", "", "33,00", "Ansell — 50 paires — via Santelia"]]);
    p("STERIL", "Bac de pré-désinfection Schulke 3 L", "unité", 1, false, J21, [["CSAD", "", "71,00", "+ panier + couvercle — via Santelia"]]);
    p("ANESTH", "Septanest 1/200 000", "boîte", 2, true, J21, [["CSAD", "", "20,91", "Septodont — x50 cartouches"]]);
    p("ANESTH", "Septanest 1/100 000", "boîte", 2, true, J21, [["CSAD", "", "20,91", "Septodont — x50 cartouches"]]);
    p("ANESTH", "Gel anesthésique Xogel — cerise", "flacon", 1, true, J21, [["CSAD", "", "133,63", "Septodont"]]);

    /* ---- CSADBOX n°334834 (21/08/2026, 908,13 €) ---- */
    p("UU", "Seringues stériles 2,5 ml", "boîte", 3, false, J21, [["CSAD", "", "6,16", "Medibase x100 — via Promodentaire"]]);
    p("STERIL", "Sachets stérilisation 18x33 cm", "boîte", 5, false, J21, [["CSAD", "", "13,50", "Medibase x200 — via Promodentaire"]]);
    p("EMPR", "Boîtes pour alginate CFPM", "unité", 2, false, J21, [["CSAD", "", "5,45", "via Promodentaire"]]);
    p("ENDO", "Hydroxyde de calcium — seringue 2 ml", "seringue", 1, true, J21, [["CSAD", "", "20,86", "Kent Dental — via Promodentaire"]]);
    p("COMPO", "Composite flow Kent — A3", "seringue", 2, true, J21, [["CSAD", "", "14,50", "2 g + 5 embouts — via Promodentaire"]]);
    p("EMPR", "Set de mesure alginate CFPM", "unité", 1, false, J21, [["CSAD", "", "1,15", "via Promodentaire"]]);
    p("COMPO", "Composite flow Kent — A2", "seringue", 2, true, J21, [["CSAD", "", "14,50", "2 g + 5 embouts — via Promodentaire"]]);
    p("HYG", "Lingettes désinfectantes niaouli", "boîte", 10, false, J21, [["CSAD", "", "2,80", "Medibase x100 — via Promodentaire"]]);
    p("EMPR", "Alginate Aroma Fine Plus prise rapide (1 kg)", "sachet", 1, true, J21, [["CSAD", "", "26,90", "GC — via Promodentaire"]]);
    p("STERIL", "Sachets stérilisation 9x25,5 cm", "boîte", 2, false, J21, [["CSAD", "", "12,90", "Medibase x200 — via Promodentaire"]]);
    p("UU", "Surchaussures bleues", "boîte", 1, false, J21, [["CSAD", "", "5,40", "Medibase x100 — via Promodentaire"]]);
    p("HYG", "Goupillons de nettoyage Mirasuc", "lot", 1, false, J21, [["CSAD", "", "9,60", "x6 — via Promodentaire"]]);
    p("RADIO", "Boîtes de rangement capteurs ERLM", "unité", 3, false, J21, [["CSAD", "", "60,60", "via Promodentaire"]]);
    p("DIV", "Spray froid menthe (200 ml)", "flacon", 2, false, J21, [["CSAD", "", "4,85", "Medibase — via Promodentaire"]]);
    p("STERIL", "Sachets stérilisation 7x25,5 cm", "boîte", 1, false, J21, [["CSAD", "", "10,90", "Medibase x200 (+1 offert) — via Promodentaire"]]);
    p("MAT", "Plaques de thermoformage carrées souples 1 mm", "boîte", 1, false, J21, [["CSAD", "", "9,50", "Clinix x12 — via Promodentaire"]]);
    p("MATR", "Kit disques à polir + mandrin (x240)", "kit", 1, false, J21, [["CSAD", "", "51,30", "Kent Dental — via Promodentaire"]]);
    p("EMPR", "Bols à alginate CFPM — bleu", "unité", 4, false, J21, [["CSAD", "", "2,56", "via Promodentaire"]]);
    p("EMPR", "Spatules à alginate coudées CFPM — blanc", "unité", 4, false, J21, [["CSAD", "", "3,95", "via Promodentaire"]]);
    p("MATR", "Kit 9 crampons Hygenic assortis", "kit", 1, false, J21, [["CSAD", "", "86,10", "via Promodentaire"]]);
    p("HYG", "Gel hydroalcoolique Exeol 82 (300 ml)", "flacon", 1, false, J21, [["CSAD", "", "5,50", "via Santelia"]]);
    p("STERIL", "Test Hélix + 250 indicateurs", "boîte", 1, false, J21, [["CSAD", "", "83,30", "Interster 18 min — via Santelia"]]);
    p("STERIL", "Indicateurs Mini Steam Star — cycle Prion", "sachet", 1, false, J21, [["CSAD", "", "16,00", "x250 — via Santelia"]]);

    /* ---- Gaines de stérilisation : commandées chez DEUX fournisseurs
            (Santelia via CSADBOX + Distrimed) → un produit, plusieurs références ---- */
    p("STERIL", "Gaine de stérilisation 50 mm x 200 m", "rouleau", 2, false, J21, [["DISTRI", "120911", "10,75", ""]]);
    p("STERIL", "Gaine de stérilisation 75 mm x 200 m", "rouleau", 4, false, J21, [["CSAD", "", "16,70", "plate — via Santelia"], ["DISTRI", "120912", "14,90", ""]]);
    p("STERIL", "Gaine de stérilisation 100 mm x 200 m", "rouleau", 4, false, J21, [["CSAD", "", "22,20", "plate — via Santelia"], ["CSAD", "", "27,90", "Medibase 10 cm — via Promodentaire"], ["DISTRI", "120913", "20,50", ""]]);
    p("STERIL", "Gaine de stérilisation 150 mm x 200 m", "rouleau", 3, false, J21, [["CSAD", "", "33,30", "plate — via Santelia"], ["DISTRI", "120914", "32,90", ""]]);
    p("STERIL", "Gaine de stérilisation 250 mm x 200 m", "rouleau", 3, false, J21, [["CSAD", "", "55,40", "plate — via Santelia"], ["DISTRI", "120916", "49,90", ""]]);

    /* ---- Dental Good Deal n°20260821DGD312989 (21/08/2026) ---- */
    p("MATR", "Striproll — rouge", "rouleau", 2, false, J21, [["DGD", "170371", "9,45", "Kerr"]]);
    p("CIMENT", "Unifast Trad poudre — ivoire couronnes", "flacon", 1, true, J21, [["DGD", "171442", "97,65", "GC"]]);
    p("CIMENT", "Unifast Trad poudre — rose gingivale", "flacon", 1, true, J21, [["DGD", "184889", "97,65", "GC"]]);
    p("HYG", "Lingettes Dento-Viractis 79", "boîte", 4, false, J21, [["DGD", "188859", "3,40", ""]]);
    p("ENDO", "Moteur d'endodontie Ai Motor", "unité", 1, false, J21, [["DGD", "195516", "916,00", "Woodpecker"]]);

    /* ---- Distrimed n°1559615 (21/08/2026) ---- */
    p("HYG", "Alcool isopropylique 70% (1 L)", "bidon", 1, false, J21, [["DISTRI", "844091", "10,70", ""]]);
    p("HYG", "Chlorhexidine alcoolique colorée 2% (100 ml)", "flacon", 1, false, J21, [["DISTRI", "873332", "5,30", ""]]);
    p("HYG", "Nettoyant dégraissant sols (5 L)", "bidon", 1, false, J21, [["DISTRI", "199862", "17,80", ""]]);
    p("HYG", "Alcool modifié 70% (250 ml)", "flacon", 1, false, J21, [["DISTRI", "115321", "1,70", ""]]);
    p("MAT", "Lunettes de protection", "unité", 2, false, J21, [["DISTRI", "062704", "2,90", ""]]);

    return {
      version: 1,
      categories: catList,
      fournisseurs: fList,
      produits,
      commandes,            // produitId -> { date } (marqué « commandé »)
      coursesManuelles: [], // { id, texte, done }
    };
  }

  /* =========================================================
     NORMALISATION (tolère les anciennes sauvegardes)
     ========================================================= */
  function normalize(s) {
    if (!s || typeof s !== "object") return seed();
    s.version = 1;
    s.categories = Array.isArray(s.categories) ? s.categories : [];
    s.fournisseurs = Array.isArray(s.fournisseurs) ? s.fournisseurs : [];
    s.produits = Array.isArray(s.produits) ? s.produits : [];
    s.commandes = (s.commandes && typeof s.commandes === "object") ? s.commandes : {};
    s.coursesManuelles = Array.isArray(s.coursesManuelles) ? s.coursesManuelles : [];
    // Suivi des commandes (v2) — champs ajoutés sans toucher aux produits/lots
    s.commandesSuivi = Array.isArray(s.commandesSuivi) ? s.commandesSuivi : [];
    s.mailsIgnores = Array.isArray(s.mailsIgnores) ? s.mailsIgnores : [];
    s.gmail = (s.gmail && typeof s.gmail === "object") ? s.gmail : {};
    // ID client OAuth du cabinet (public par nature) : pré-rempli pour éviter la saisie
    if (!s.gmail.clientId) s.gmail.clientId = GMAIL_CLIENT_ID_DEFAUT;
    if (!s.gmail.compte) s.gmail.compte = "cybeledent@gmail.com";
    s.commandesSuivi.forEach(c => {
      c.id = c.id || uid();
      c.numero = String(c.numero || "");
      c.date = c.date || todayIso();
      c.fournisseurId = c.fournisseurId || "";
      c.fournisseurNom = c.fournisseurNom || "";
      c.total = Number(c.total) > 0 ? Number(c.total) : 0;
      c.fraisPort = Number(c.fraisPort) > 0 ? Number(c.fraisPort) : 0;
      c.statut = ["attente", "partielle", "recue", "archivee"].includes(c.statut) ? c.statut : "attente";
      c.lignes = Array.isArray(c.lignes) ? c.lignes : [];
      c.lignes.forEach(l => {
        l.id = l.id || uid();
        l.designation = String(l.designation || "");
        l.ref = String(l.ref || "");
        l.produitId = l.produitId || null;
        l.refId = l.refId || null;
        l.qty = Math.max(1, Math.round(Number(l.qty) || 1));
        l.prix = Number(l.prix) > 0 ? Number(l.prix) : 0;
        l.recu = Math.max(0, Math.round(Number(l.recu) || 0));
      });
      if (c.statut !== "archivee") c.statut = statutCommande(c);
    });
    s.produits.forEach(p => {
      p.unite = p.unite || "boîte";
      p.stockIdeal = num(p.stockIdeal);
      p.seuilMini = num(p.seuilMini);
      p.alertePeremption = !!p.alertePeremption;
      p.delaiAlerteMois = num(p.delaiAlerteMois) || 3;
      p.enCave = !!p.enCave;
      p.references = Array.isArray(p.references) ? p.references : [];
      p.references.forEach(r => { r.gtins = Array.isArray(r.gtins) ? r.gtins : []; });
      p.lots = Array.isArray(p.lots) ? p.lots : [];
      p.lots.forEach(l => { l.qty = num(l.qty); });
      p.lots = p.lots.filter(l => l.qty > 0);
    });
    return s;
  }
  function num(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }

  /* =========================================================
     PETITS OUTILS
     ========================================================= */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return d + "/" + m + "/" + y;
  }
  // Date locale (pas UTC : évite un décalage de jour tard le soir)
  function localIso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function todayIso() { return localIso(new Date()); }

  function produit(id) { return state.produits.find(p => p.id === id) || null; }
  function categorie(id) { return state.categories.find(c => c.id === id) || null; }
  function fournisseur(id) { return state.fournisseurs.find(f => f.id === id) || null; }
  function reference(p, refId) { return p.references.find(r => r.id === refId) || null; }

  function stockTotal(p) { return p.lots.reduce((t, l) => t + l.qty, 0); }

  // FEFO : lots triés par péremption croissante (sans date en dernier)
  function lotsFefo(p) {
    return p.lots.slice().sort((a, b) => {
      if (a.peremption && b.peremption) return a.peremption < b.peremption ? -1 : 1;
      if (a.peremption) return -1;
      if (b.peremption) return 1;
      return (a.entree || "") < (b.entree || "") ? -1 : 1;
    });
  }

  function stockClass(p) {
    const t = stockTotal(p);
    if (t <= p.seuilMini) return "stock-low";
    if (p.stockIdeal && t < p.stockIdeal) return "stock-warn";
    return "stock-ok";
  }

  // Statut de péremption d'un lot pour un produit donné
  function peremptionStatus(p, lot) {
    if (!lot.peremption) return null;
    const today = todayIso();
    if (lot.peremption < today) return "past";
    if (!p.alertePeremption) return "ok";
    const limite = new Date();
    limite.setMonth(limite.getMonth() + p.delaiAlerteMois);
    return lot.peremption <= localIso(limite) ? "soon" : "ok";
  }

  /* ---- Liste de courses calculée ---- */
  function aCommander() {
    // Nettoie les commandes reçues (le stock est repassé au-dessus du seuil)
    Object.keys(state.commandes).forEach(pid => {
      const p = produit(pid);
      if (!p || stockTotal(p) > p.seuilMini) delete state.commandes[pid];
    });
    const besoin = [], enAttente = [];
    state.produits.forEach(p => {
      if (stockTotal(p) <= p.seuilMini) {
        const item = { p, qty: Math.max(1, p.stockIdeal - stockTotal(p)) };
        if (state.commandes[p.id]) enAttente.push(item); else besoin.push(item);
      }
    });
    const byName = (a, b) => a.p.name.localeCompare(b.p.name, "fr");
    besoin.sort(byName); enAttente.sort(byName);
    return { besoin, enAttente };
  }

  /* ---- Alertes péremption calculées ---- */
  function alertesPeremption() {
    const past = [], soon = [];
    state.produits.forEach(p => {
      p.lots.forEach(l => {
        const st = peremptionStatus(p, l);
        if (st === "past") past.push({ p, l });
        else if (st === "soon") soon.push({ p, l });
      });
    });
    const byDate = (a, b) => (a.l.peremption < b.l.peremption ? -1 : 1);
    past.sort(byDate); soon.sort(byDate);
    return { past, soon };
  }

  /* =========================================================
     ANALYSE DES CODES GS1 (Datamatrix / code-barres)
     Les produits médicaux portent souvent un code GS1 :
     (01) GTIN produit, (17) date de péremption, (10) n° de lot
     ========================================================= */
  const GS = String.fromCharCode(29); // séparateur FNC1
  const AI_FIXED = { "00": 18, "01": 14, "02": 14, "11": 6, "12": 6, "13": 6, "15": 6, "16": 6, "17": 6, "20": 2 };
  const AI_VAR = { "10": 20, "21": 20, "22": 20, "30": 8, "37": 8, "240": 30, "241": 30, "250": 30, "251": 30, "400": 30, "401": 30, "710": 20, "711": 20, "712": 20, "713": 20, "714": 20 };
  const AI_METRIC = /^31[0-9]|^32[0-9]|^33[0-9]|^34[0-9]|^35[0-9]|^36[0-9]$/; // 310x-369x : 6 chiffres

  function parseGs1(raw) {
    let s = String(raw || "").trim();
    if (!s) return null;
    // Préfixe de symbologie éventuel : ]d2 ]C1 ]Q3 ]e0 …
    if (s[0] === "]") s = s.slice(3);
    // Code-barres simple (EAN-8/12/13/14) : juste un GTIN
    if (/^\d{8}$|^\d{12,14}$/.test(s)) return { gtin: s, peremption: null, lot: null, raw: raw };

    const out = { gtin: null, peremption: null, lot: null, raw: raw };
    let i = 0, foundAny = false;
    while (i < s.length) {
      while (s[i] === GS) i++;
      if (i >= s.length) break;
      let ai = null, len = 0, variable = false;
      const a2 = s.substr(i, 2), a3 = s.substr(i, 3), a4 = s.substr(i, 4);
      if (AI_FIXED[a2] != null) { ai = a2; len = AI_FIXED[a2]; }
      else if (AI_VAR[a2] != null) { ai = a2; len = AI_VAR[a2]; variable = true; }
      else if (AI_VAR[a3] != null) { ai = a3; len = AI_VAR[a3]; variable = true; }
      else if (AI_METRIC.test(a3) && /^\d{4}$/.test(a4)) { ai = a4; len = 6; }
      else if (/^\d{4}$/.test(a4)) { ai = a4; len = 30; variable = true; } // AI inconnu : on avale jusqu'au séparateur
      else break; // contenu non GS1
      i += ai.length;
      let val;
      if (variable) {
        let j = s.indexOf(GS, i);
        if (j === -1) j = Math.min(s.length, i + len);
        val = s.slice(i, j);
        i = j;
      } else {
        val = s.substr(i, len);
        i += len;
      }
      foundAny = true;
      if (ai === "01" || ai === "02") out.gtin = val;
      else if (ai === "17" || ai === "15") { out.peremption = gs1Date(val) || out.peremption; }
      else if (ai === "10") out.lot = val;
    }
    if (!foundAny) {
      // Pas un GS1 : on garde le texte brut comme identifiant (QR maison, etc.)
      return { gtin: s, peremption: null, lot: null, raw: raw };
    }
    return out;
  }

  // AAMMJJ → ISO ; jour "00" = fin de mois
  function gs1Date(v) {
    if (!/^\d{6}$/.test(v)) return null;
    const yy = Number(v.slice(0, 2)), mm = Number(v.slice(2, 4));
    let dd = Number(v.slice(4, 6));
    if (mm < 1 || mm > 12) return null;
    const year = 2000 + yy;
    if (dd === 0) dd = new Date(year, mm, 0).getDate(); // dernier jour du mois
    return year + "-" + String(mm).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
  }

  function normGtin(g) { return String(g || "").replace(/\D/g, "").replace(/^0+/, ""); }

  // Exposé pour les tests (console)
  window.CybeleStockDev = { parseGs1, gs1Date, normGtin };

  // Retrouve (produit, référence) à partir d'un GTIN scanné
  function findByGtin(gtin) {
    const n = normGtin(gtin);
    if (!n) return null;
    for (const p of state.produits) {
      for (const r of p.references) {
        if (r.gtins.some(g => normGtin(g) === n)) return { p, r };
      }
    }
    return null;
  }

  /* =========================================================
     RENDU GÉNÉRAL
     ========================================================= */
  function switchView(name, extra) {
    if (view.name === "scan" && name !== "scan") stopScanner();
    view = Object.assign({ name, produitId: null, ficheTab: "stock", search: view.search }, extra || {});
    if (name !== "stock") view.search = "";
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    updateBadges();
    document.querySelectorAll(".nav-tab").forEach(t => {
      const target = t.dataset.nav;
      t.classList.toggle("active", view.name === target || (view.name === "fiche" && target === "stock")
        || (view.name === "commande" && target === "commandes"));
    });
    if (view.name === "accueil") renderAccueil();
    else if (view.name === "stock") renderStock();
    else if (view.name === "fiche") renderFiche();
    else if (view.name === "scan") renderScan();
    else if (view.name === "courses") renderCourses();
    else if (view.name === "peremption") renderPeremption();
    else if (view.name === "commandes") renderCommandes();
    else if (view.name === "commande") renderCommandeDetail();
    else if (view.name === "reglages") renderReglages();
  }

  function updateBadges() {
    const { besoin } = aCommander();
    const manuels = state.coursesManuelles.filter(c => !c.done).length;
    const bC = document.getElementById("badge-courses");
    const nC = besoin.length + manuels;
    bC.hidden = nC === 0; bC.textContent = nC;
    const { past, soon } = alertesPeremption();
    const bP = document.getElementById("badge-peremption");
    const nP = past.length + soon.length;
    bP.hidden = nP === 0; bP.textContent = nP;
    const bK = document.getElementById("badge-commandes");
    if (bK) {
      const nK = state.commandesSuivi.filter(c => c.statut === "partielle" || c.statut === "recue").length;
      bK.hidden = nK === 0; bK.textContent = nK;
    }
  }

  /* =========================================================
     VUE : ACCUEIL (tableau de bord)
     ========================================================= */
  function prenomUtilisateur() {
    const email = window.CybeleAuth && window.CybeleAuth.email ? window.CybeleAuth.email() : null;
    if (!email) return "";
    const local = email.split("@")[0].split(/[._-]/)[0];
    return local ? local.charAt(0).toUpperCase() + local.slice(1) : "";
  }
  function renderAccueil() {
    const { besoin, enAttente } = aCommander();
    const { past, soon } = alertesPeremption();
    const cmdsEnCours = state.commandesSuivi.filter(c => c.statut !== "archivee").sort((a, b) => (a.date < b.date ? 1 : -1));
    const aRecevoir = cmdsEnCours.length;
    const fin = financeStats();
    const moisNow = todayIso().slice(0, 7), anNow = todayIso().slice(0, 4);
    const mois6 = derniersMois(6);
    const maxM = Math.max(1, ...mois6.map(k => fin.parMois[k] || 0));
    const catKeys = Object.keys(fin.parCat).filter(k => fin.parCat[k] > 0).sort((a, b) => fin.parCat[b] - fin.parCat[a]).slice(0, 4);
    const enStock = state.produits.filter(p => stockTotal(p) > 0).length;
    const nbPerempt = past.length + soon.length;
    const prenom = prenomUtilisateur();
    const dateJour = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    const ordre = { recue: 0, partielle: 1, attente: 2 };
    const cmdsTri = cmdsEnCours.slice().sort((a, b) => ordre[a.statut] - ordre[b.statut]);
    const sousTitre = [];
    if (aRecevoir) sousTitre.push(`${aRecevoir} livraison${aRecevoir > 1 ? "s" : ""} attendue${aRecevoir > 1 ? "s" : ""}`);
    if (besoin.length) sousTitre.push(`${besoin.length} produit${besoin.length > 1 ? "s" : ""} à commander`);
    if (past.length) sousTitre.push(`${past.length} lot${past.length > 1 ? "s" : ""} périmé${past.length > 1 ? "s" : ""}`);

    const kpi = (cls, icon, n, label, nav, extra) => `
      <button class="kpi" data-go="${nav}" ${extra || ""}>
        <span class="kpi-ico ${cls}">${ico(icon, 28)}</span>
        <span class="kpi-n">${n}</span>
        <span class="kpi-l">${label}</span>
        <span class="kpi-a">${ico("arrow", 16)}</span>
      </button>`;

    app.innerHTML = `
      <div class="hello">
        <h1>Bonjour${prenom ? " " + esc(prenom) : ""}</h1>
        <p>${dateJour.charAt(0).toUpperCase() + dateJour.slice(1)}${sousTitre.length ? " · " + sousTitre.join(" · ") : " · tout est en ordre"}</p>
      </div>
      <div class="kpis">
        ${kpi(besoin.length ? "amber" : "teal", "alert", besoin.length, `produit${besoin.length > 1 ? "s" : ""} à commander`, "courses")}
        ${kpi("teal", "box", enStock, `produit${enStock > 1 ? "s" : ""} en stock <span style="font-weight:400">/ ${state.produits.length}</span>`, "stock")}
        ${kpi("blue", "truck", aRecevoir, `commande${aRecevoir > 1 ? "s" : ""} à réceptionner`, "commandes")}
        ${kpi(past.length ? "red" : "purple", "clock", nbPerempt, `péremption${nbPerempt > 1 ? "s" : ""} à surveiller`, "peremption")}
      </div>
      <div class="dash-row">
        <div class="card hero" data-go="finances" role="button">
          <h3>Valeur du stock <small>temps réel</small></h3>
          <div class="big">${fmtEur(fin.valeur)}</div>
          <div class="sub">${state.produits.length} produit${state.produits.length > 1 ? "s" : ""} · ${fmtEur(fin.parMois[moisNow] || 0)} dépensés ce mois-ci · ${fmtEur(fin.parAn[anNow] || 0)} en ${anNow}</div>
          <div class="bars">${mois6.map(k => `<div class="${k === moisNow ? "on" : ""}" style="height:${Math.max(6, Math.round((fin.parMois[k] || 0) / maxM * 100))}%" title="${moisLabel(k)} : ${fmtEur(fin.parMois[k] || 0)}"><span>${esc(moisLabel(k, true).replace(".", ""))}</span></div>`).join("")}</div>
          <div class="hero-link">${fin.nbSans ? `<span style="opacity:.85;font-weight:500">${fin.nbSans} produit${fin.nbSans > 1 ? "s" : ""} sans prix connu · </span>` : ""}Voir dépenses &amp; prix ${ico("arrow", 16)}</div>
        </div>
        <div class="card">
          <h3>Commandes en cours <small>${aRecevoir}</small></h3>
          ${cmdsTri.length ? cmdsTri.slice(0, 3).map(c => {
            const tot = c.lignes.reduce((t, l) => t + l.qty, 0), rec = c.lignes.reduce((t, l) => t + Math.min(l.recu, l.qty), 0);
            return `<div class="li li-block" data-open-cmd="${c.id}">
              <div class="li-top"><div><b>${esc(nomFournisseurCommande(c))}</b><div class="sub">${c.numero ? "n° " + esc(c.numero) + " · " : ""}${fmtEur(montantCommande(c))}</div></div>
                <span class="pill ${c.statut === "partielle" ? "p-amber" : c.statut === "recue" ? "p-teal" : "p-blue"}">${c.statut === "partielle" ? rec + " / " + tot + " reçus" : c.statut === "recue" ? "À archiver" : "En attente"}</span></div>
              ${c.statut === "partielle" ? `<div class="prog"><i style="width:${tot ? Math.round(rec / tot * 100) : 0}%"></i></div>` : ""}
            </div>`; }).join("") : `<div class="sub" style="padding:6px 0 10px">Aucune commande en cours.</div>`}
          ${cmdsTri.length > 3 ? `<div class="sub" style="padding-top:8px"><a href="#" data-go="commandes">Voir les ${cmdsTri.length} commandes →</a></div>` : ""}
          <h3 style="margin-top:16px">À commander <small>${besoin.length}</small></h3>
          ${besoin.length ? besoin.slice(0, 4).map(({ p }) => `<div class="li" data-goto="${p.id}"><span>${esc(p.name)}</span><span class="pill ${stockTotal(p) === 0 ? "p-red" : "p-amber"}">${stockTotal(p)} / ${p.stockIdeal || "?"}</span></div>`).join("")
            : `<div class="sub" style="padding:6px 0">Rien à commander : tous les stocks sont au-dessus de leur seuil.</div>`}
          ${besoin.length > 4 ? `<div class="sub" style="padding-top:8px"><a href="#" data-go="courses">Voir la liste complète (${besoin.length}) →</a></div>` : ""}
        </div>
        <div class="card">
          <h3>Péremptions <small>${nbPerempt} lot${nbPerempt > 1 ? "s" : ""}</small></h3>
          ${nbPerempt ? past.concat(soon).slice(0, 4).map(({ p, l }) => `<div class="li" data-goto="${p.id}"><div><b>${esc(p.name)}</b><div class="sub">${l.qty} ${esc(p.unite)}${l.qty > 1 ? "s" : ""}${l.lot ? " · lot " + esc(l.lot) : ""}</div></div><span class="pill ${l.peremption < todayIso() ? "p-red" : "p-amber"}">${fmtDate(l.peremption).slice(0, 5)}</span></div>`).join("")
            : `<div class="sub" style="padding:6px 0">Aucun lot périmé ni bientôt périmé.</div>`}
          ${nbPerempt > 4 ? `<div class="sub" style="padding-top:8px"><a href="#" data-go="peremption">Voir toutes les alertes (${nbPerempt}) →</a></div>` : ""}
          <h3 style="margin-top:16px">Stock par catégorie <small>valeur</small></h3>
          ${catKeys.length ? catKeys.map(k => `<div class="li"><span>${esc(k)}</span><b>${fmtEur(fin.parCat[k])}</b></div>`).join("") : `<div class="sub" style="padding:6px 0">Renseignez des prix (ou intégrez des commandes) pour valoriser le stock.</div>`}
        </div>
      </div>`;

    app.querySelectorAll("[data-go]").forEach(el => el.onclick = (e) => {
      e.preventDefault();
      const t = el.dataset.go;
      if (t === "finances") { cmdTab = "finances"; switchView("commandes"); }
      else switchView(t);
    });
    app.querySelectorAll("[data-open-cmd]").forEach(el => el.onclick = () => switchView("commande", { commandeId: el.dataset.openCmd }));
    app.querySelectorAll("[data-goto]").forEach(el => el.onclick = () => switchView("fiche", { produitId: el.dataset.goto }));
  }

  /* =========================================================
     VUE : STOCK
     ========================================================= */
  function renderStock() {
    const q = view.search.trim().toLowerCase();
    const caveOnly = !!view.cave;
    let html = `
      <div class="toolbar">
        <div class="grow"><input class="search-input" id="stock-search" type="search"
             placeholder="Rechercher un produit…" value="${esc(view.search)}"></div>
        <button class="btn ${caveOnly ? "filter-on" : ""}" id="btn-cave-filter" title="N'afficher que les produits rangés (aussi) à la cave">${ico("house", 18)} Cave</button>
        <button class="btn btn-primary" id="btn-add-prod">＋ Produit</button>
        <button class="btn" id="btn-add-cat">＋ Catégorie</button>
      </div>`;

    const cats = state.categories.slice();
    const sansCat = state.produits.filter(p => !categorie(p.categorieId));
    if (sansCat.length) cats.push({ id: "__none__", name: "Sans catégorie" });

    const filtre = q || caveOnly; // en mode filtré : catégories vides masquées, le reste déplié
    let totalShown = 0;
    cats.forEach(c => {
      let prods = c.id === "__none__" ? sansCat : state.produits.filter(p => p.categorieId === c.id);
      if (caveOnly) prods = prods.filter(p => p.enCave);
      if (q) prods = prods.filter(p => p.name.toLowerCase().includes(q) ||
        p.references.some(r => (r.ref || "").toLowerCase().includes(q) || (r.designation || "").toLowerCase().includes(q)));
      if (!prods.length && (filtre || c.id === "__none__")) return;
      totalShown += prods.length;
      prods.sort((a, b) => a.name.localeCompare(b.name, "fr"));
      const alerte = prods.some(p => stockTotal(p) <= p.seuilMini);
      const closed = !openCats.has(c.id) && !filtre;
      html += `
        <section class="cat-block ${closed ? "closed" : ""}" data-cat="${c.id}">
          <button class="cat-head" data-toggle-cat="${c.id}">
            ${alerte ? '<span class="cat-alert-dot" title="Produit(s) à commander"></span>' : ""}
            <h3>${esc(c.name)}</h3>
            <span class="cat-count">${prods.length} produit${prods.length > 1 ? "s" : ""}</span>
            <span class="cat-chevron">▼</span>
          </button>
          <div class="prod-list">
            ${prods.map(p => prodRow(p)).join("") || '<div class="empty-note" style="padding:16px">Aucun produit dans cette catégorie.</div>'}
          </div>
        </section>`;
    });

    if (!state.produits.length) {
      html += `<div class="empty-note">Aucun produit pour l'instant.<br>Cliquez sur <strong>＋ Produit</strong> pour commencer.</div>`;
    } else if (caveOnly && totalShown === 0) {
      html += `<div class="empty-note">Aucun produit n'est marqué « à la cave »${q ? " avec cette recherche" : ""}.<br>
        Cochez « 🏠 Une partie du stock est rangée à la cave » dans la fiche d'un produit (⚙️ Réglages).</div>`;
    } else if (q && totalShown === 0) {
      html += `<div class="empty-note">Aucun produit ne correspond à « ${esc(view.search)} ».</div>`;
    }

    app.innerHTML = html;

    const search = document.getElementById("stock-search");
    search.oninput = () => { view.search = search.value; renderStockDebounced(); };
    document.getElementById("btn-cave-filter").onclick = () => { view.cave = !view.cave; renderStock(); };
    document.getElementById("btn-add-prod").onclick = () => openProduitModal(null);
    document.getElementById("btn-add-cat").onclick = () => openCategorieModal(null);
    app.querySelectorAll("[data-toggle-cat]").forEach(b => b.onclick = () => {
      const id = b.dataset.toggleCat;
      if (openCats.has(id)) openCats.delete(id); else openCats.add(id);
      b.closest(".cat-block").classList.toggle("closed");
    });
    bindProdRows();
  }

  let searchTimer;
  function renderStockDebounced() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const el = document.getElementById("stock-search");
      const pos = el ? el.selectionStart : 0;
      renderStock();
      const el2 = document.getElementById("stock-search");
      if (el2) { el2.focus(); try { el2.setSelectionRange(pos, pos); } catch (e) {} }
    }, 180);
  }

  function prodRow(p) {
    const t = stockTotal(p);
    const { past, soon } = lotAlertCount(p);
    return `
      <div class="prod-row" data-prod="${p.id}">
        <div class="prod-main" data-open="${p.id}">
          <div class="prod-name">${esc(p.name)}</div>
          <div class="prod-meta">
            <span>idéal ${p.stockIdeal || "—"} · seuil ${p.seuilMini || "0"}</span>
            ${p.enCave ? '<span class="cave-chip">🏠 aussi à la cave</span>' : ""}
            ${p.references.length ? `<span>${p.references.length} réf.</span>` : ""}
            ${past ? `<span style="color:var(--danger);font-weight:600">${past} lot(s) périmé(s)</span>` : ""}
            ${soon ? `<span style="color:var(--warn);font-weight:600">${soon} bientôt périmé(s)</span>` : ""}
          </div>
        </div>
        <span class="stock-pill ${stockClass(p)}">${t}<small> ${esc(p.unite)}${t > 1 ? "s" : ""}</small></span>
        <div class="qty-btns">
          <button class="qty-btn minus" data-minus="${p.id}" title="Sortir 1 du stock">−</button>
          <button class="qty-btn" data-plus="${p.id}" title="Entrée en stock">＋</button>
        </div>
      </div>`;
  }

  function lotAlertCount(p) {
    let past = 0, soon = 0;
    p.lots.forEach(l => {
      const st = peremptionStatus(p, l);
      if (st === "past") past++; else if (st === "soon") soon++;
    });
    return { past, soon };
  }

  function bindProdRows() {
    app.querySelectorAll("[data-open]").forEach(el => el.onclick = () =>
      switchView("fiche", { produitId: el.dataset.open }));
    app.querySelectorAll("[data-minus]").forEach(el => el.onclick = (e) => {
      e.stopPropagation(); quickSortie(el.dataset.minus);
    });
    app.querySelectorAll("[data-plus]").forEach(el => el.onclick = (e) => {
      e.stopPropagation(); openEntreeModal(el.dataset.plus, {});
    });
  }

  // Sortie rapide : retire 1 du lot qui périme en premier (FEFO)
  function quickSortie(pid) {
    const p = produit(pid); if (!p) return;
    const lots = lotsFefo(p);
    if (!lots.length) { toast("Stock déjà à zéro."); return; }
    const lot = lots[0];
    lot.qty -= 1;
    const removed = lot.qty <= 0;
    if (removed) p.lots = p.lots.filter(l => l.id !== lot.id);
    save(); render();
    toastUndo(`−1 ${esc(p.name)} (reste ${stockTotal(p)})`, () => {
      if (removed) { lot.qty = 1; p.lots.push(lot); } else { lot.qty += 1; }
      save(); render();
    });
  }

  /* =========================================================
     VUE : FICHE PRODUIT
     ========================================================= */
  function renderFiche() {
    const p = produit(view.produitId);
    if (!p) { switchView("stock"); return; }
    const t = stockTotal(p);
    let html = `
      <div class="fiche-head">
        <button class="fiche-back" id="fiche-back" title="Retour">←</button>
        <div style="flex:1">
          <h2>${esc(p.name)}</h2>
          <div class="prod-meta">${esc((categorie(p.categorieId) || {}).name || "Sans catégorie")} ·
            <span class="stock-pill ${stockClass(p)}" style="padding:2px 10px">${t} <small>${esc(p.unite)}${t > 1 ? "s" : ""}</small></span>
            idéal ${p.stockIdeal || "—"} · seuil ${p.seuilMini || "0"}
            ${p.enCave ? ' <span class="cave-chip">🏠 aussi à la cave</span>' : ""}</div>
        </div>
      </div>
      <div class="fiche-tabs">
        <button class="fiche-tab ${view.ficheTab === "stock" ? "active" : ""}" data-ftab="stock">📦 Stock</button>
        <button class="fiche-tab ${view.ficheTab === "refs" ? "active" : ""}" data-ftab="refs">🏷 Références (${p.references.length})</button>
        <button class="fiche-tab ${view.ficheTab === "param" ? "active" : ""}" data-ftab="param">⚙️ Réglages</button>
      </div>`;

    if (view.ficheTab === "stock") html += ficheStockTab(p);
    else if (view.ficheTab === "refs") html += ficheRefsTab(p);
    else html += ficheParamTab(p);

    app.innerHTML = html;
    document.getElementById("fiche-back").onclick = () => switchView("stock");
    app.querySelectorAll("[data-ftab]").forEach(b => b.onclick = () => { view.ficheTab = b.dataset.ftab; render(); });

    if (view.ficheTab === "stock") {
      document.getElementById("btn-entree").onclick = () => openEntreeModal(p.id, {});
      document.getElementById("btn-sortie").onclick = () => openSortieModal(p.id, {});
      app.querySelectorAll("[data-lot-plus]").forEach(b => b.onclick = () => {
        const l = p.lots.find(x => x.id === b.dataset.lotPlus);
        if (l) { l.qty += 1; save(); render(); }
      });
      app.querySelectorAll("[data-lot-minus]").forEach(b => b.onclick = () => {
        const l = p.lots.find(x => x.id === b.dataset.lotMinus);
        if (!l) return;
        l.qty -= 1;
        if (l.qty <= 0) p.lots = p.lots.filter(x => x.id !== l.id);
        save(); render();
      });
      app.querySelectorAll("[data-lot-del]").forEach(b => b.onclick = () => {
        if (!confirm("Retirer ce lot du stock ?")) return;
        p.lots = p.lots.filter(x => x.id !== b.dataset.lotDel);
        save(); render();
      });
    } else if (view.ficheTab === "refs") {
      document.getElementById("btn-add-ref").onclick = () => openRefModal(p.id, null);
      app.querySelectorAll("[data-edit-ref]").forEach(b => b.onclick = () => openRefModal(p.id, b.dataset.editRef));
      app.querySelectorAll("[data-del-gtin]").forEach(b => b.onclick = () => {
        const [refId, idx] = b.dataset.delGtin.split("|");
        const r = reference(p, refId);
        if (r && confirm("Oublier ce code scanné ?")) { r.gtins.splice(Number(idx), 1); save(); render(); }
      });
    } else {
      bindParamTab(p);
    }
  }

  function ficheStockTab(p) {
    const lots = lotsFefo(p);
    return `
      <div class="toolbar">
        <button class="btn btn-primary" id="btn-entree">＋ Entrée en stock</button>
        <button class="btn" id="btn-sortie" ${lots.length ? "" : "disabled"}>− Sortie</button>
      </div>
      <div class="card">
        <h4>Lots en stock</h4>
        ${lots.length ? lots.map(l => {
          const st = peremptionStatus(p, l);
          const r = l.refId ? reference(p, l.refId) : null;
          const f = r ? fournisseur(r.fournisseurId) : null;
          return `
            <div class="lot-row">
              <span class="lot-qty">${l.qty}</span>
              <div class="lot-info">
                <div>${l.peremption ? `<span class="perempt-chip perempt-${st === "past" ? "past" : st === "soon" ? "soon" : "ok"}">${st === "past" ? "périmé " : "exp. "}${fmtDate(l.peremption)}</span>` : '<span class="lot-sub">sans date de péremption</span>'}</div>
                <div class="lot-sub">
                  ${l.lot ? "lot " + esc(l.lot) + " · " : ""}${f ? esc(f.name) : ""}${r && r.ref ? " réf " + esc(r.ref) : ""}
                  ${l.entree ? " · entré le " + fmtDate(l.entree) : ""}
                </div>
              </div>
              <div class="qty-btns">
                <button class="qty-btn minus" data-lot-minus="${l.id}" title="−1">−</button>
                <button class="qty-btn" data-lot-plus="${l.id}" title="+1">＋</button>
                <button class="qty-btn" data-lot-del="${l.id}" title="Retirer le lot">🗑</button>
              </div>
            </div>`;
        }).join("") : '<div class="lot-sub" style="padding:8px 0">Aucun lot en stock. Utilisez « ＋ Entrée en stock » ou scannez le produit.</div>'}
      </div>
      ${p.note ? `<div class="card"><h4>Note</h4><div style="font-size:.9rem;color:var(--muted);white-space:pre-wrap">${esc(p.note)}</div></div>` : ""}`;
  }

  function ficheRefsTab(p) {
    return `
      <div class="toolbar">
        <button class="btn btn-primary" id="btn-add-ref">＋ Référence</button>
      </div>
      <div class="card">
        <h4>Références fournisseurs</h4>
        <p class="lot-sub" style="margin-bottom:8px">Le même produit peut se commander sous plusieurs références
        (fournisseurs, marques ou conditionnements différents). Les codes scannés s'associent à une référence.</p>
        ${p.references.length ? p.references.map(r => {
          const f = fournisseur(r.fournisseurId);
          return `
            <div class="ref-row">
              <div class="ref-info">
                <div class="ref-fournisseur">${f ? esc(f.name) : "Fournisseur ?"} ${r.prix ? `<span style="color:var(--accent-dark);font-weight:600">· ${esc(r.prix)} €</span>` : ""}</div>
                <div class="ref-sub">${r.ref ? "réf " + esc(r.ref) : ""}${r.designation ? " · " + esc(r.designation) : ""}</div>
                ${r.gtins.length ? `<div class="ref-sub">codes : ${r.gtins.map((g, i) =>
                  `<span style="white-space:nowrap">${esc(g)} <button data-del-gtin="${r.id}|${i}" style="border:none;background:none;color:var(--danger);cursor:pointer" title="Oublier ce code">✕</button></span>`).join(" ")}</div>` : ""}
                ${r.note ? `<div class="ref-sub">${esc(r.note)}</div>` : ""}
              </div>
              ${r.url ? `<a class="link-btn" href="${esc(r.url)}" target="_blank" rel="noopener">🔗 Voir</a>` : ""}
              <button class="btn btn-sm" data-edit-ref="${r.id}">✎</button>
            </div>`;
        }).join("") : '<div class="lot-sub" style="padding:8px 0">Aucune référence. Ajoutez-en une, ou scannez le produit : l\'association sera proposée.</div>'}
      </div>`;
  }

  function ficheParamTab(p) {
    return `
      <div class="card">
        <h4>Paramètres du produit</h4>
        <div class="form-grid">
          <div class="field full"><label>Nom du produit</label>
            <input id="pp-name" value="${esc(p.name)}"></div>
          <div class="field"><label>Catégorie</label>
            <select id="pp-cat">${state.categories.map(c =>
              `<option value="${c.id}" ${c.id === p.categorieId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Unité</label>
            <input id="pp-unite" value="${esc(p.unite)}" placeholder="boîte, flacon…"></div>
          <div class="field"><label>Stock idéal</label>
            <input id="pp-ideal" type="number" min="0" value="${p.stockIdeal || ""}"></div>
          <div class="field"><label>Seuil mini (déclenche la commande)</label>
            <input id="pp-seuil" type="number" min="0" value="${p.seuilMini || ""}"></div>
          <div class="field full">
            <div class="check-line"><input type="checkbox" id="pp-alerte" ${p.alertePeremption ? "checked" : ""}>
              <span>Alerter avant péremption</span></div>
          </div>
          <div class="field"><label>Alerte … mois avant</label>
            <input id="pp-delai" type="number" min="1" max="24" value="${p.delaiAlerteMois}"></div>
          <div class="field full">
            <div class="check-line"><input type="checkbox" id="pp-cave" ${p.enCave ? "checked" : ""}>
              <span>🏠 Une partie du stock est rangée <strong>à la cave</strong></span></div>
          </div>
          <div class="field full"><label>Note</label>
            <textarea id="pp-note">${esc(p.note || "")}</textarea></div>
        </div>
        <div class="toolbar" style="margin-top:12px">
          <button class="btn btn-primary" id="pp-save">Enregistrer</button>
          <button class="btn btn-danger" id="pp-del" style="margin-left:auto">🗑 Supprimer le produit</button>
        </div>
      </div>
      <div class="card">
        <h4>Fusionner dans un autre produit</h4>
        <p class="lot-sub" style="margin-bottom:10px">Transfère toutes les références (avec leurs codes scannés)
        et tout le stock de « ${esc(p.name)} » vers le produit choisi, puis supprime « ${esc(p.name)} ».
        Utile pour regrouper des variantes sous un produit générique (ex. « Gants taille S »).
        Les réglages (stock idéal, seuil…) du produit de destination sont conservés.</p>
        <div class="toolbar">
          <select id="pp-merge" class="grow" style="padding:9px 11px;border:1px solid var(--line);border-radius:10px">
            <option value="">— choisir le produit de destination —</option>
            ${state.produits.filter(x => x.id !== p.id).sort((a, b) => a.name.localeCompare(b.name, "fr")).map(x =>
              `<option value="${x.id}">${esc(x.name)}</option>`).join("")}
          </select>
          <button class="btn" id="pp-merge-btn">⇄ Fusionner</button>
        </div>
      </div>`;
  }

  function bindParamTab(p) {
    document.getElementById("pp-save").onclick = () => {
      const name = document.getElementById("pp-name").value.trim();
      if (!name) { toast("Le nom est obligatoire."); return; }
      p.name = name;
      p.categorieId = document.getElementById("pp-cat").value;
      p.unite = document.getElementById("pp-unite").value.trim() || "boîte";
      p.stockIdeal = num(document.getElementById("pp-ideal").value);
      p.seuilMini = num(document.getElementById("pp-seuil").value);
      p.alertePeremption = document.getElementById("pp-alerte").checked;
      p.delaiAlerteMois = num(document.getElementById("pp-delai").value) || 3;
      p.enCave = document.getElementById("pp-cave").checked;
      p.note = document.getElementById("pp-note").value.trim();
      save(); render(); toast("Produit enregistré.");
    };
    document.getElementById("pp-del").onclick = () => {
      if (!confirm(`Supprimer « ${p.name} » et tout son stock ?`)) return;
      state.produits = state.produits.filter(x => x.id !== p.id);
      delete state.commandes[p.id];
      save(); switchView("stock"); toast("Produit supprimé.");
    };
    document.getElementById("pp-merge-btn").onclick = () => {
      const t = produit(document.getElementById("pp-merge").value);
      if (!t) { toast("Choisissez d'abord le produit de destination."); return; }
      if (!confirm(`Fusionner « ${p.name} » dans « ${t.name} » ?\n\nRéférences, codes scannés et stock sont transférés ; les réglages de « ${t.name} » sont conservés.`)) return;
      t.references.push(...p.references);
      t.lots.push(...p.lots);
      if (state.commandes[p.id] && !state.commandes[t.id]) state.commandes[t.id] = state.commandes[p.id];
      delete state.commandes[p.id];
      state.produits = state.produits.filter(x => x.id !== p.id);
      save(); switchView("fiche", { produitId: t.id, ficheTab: "refs" });
      toast(`Fusionné dans « ${t.name} » (stock : ${stockTotal(t)}).`);
    };
  }

  /* =========================================================
     VUE : SCANNER
     ========================================================= */
  let scanner = null;
  let scannerOn = false;
  let scanMode = "entree";
  let lastScanText = "", lastScanTime = 0;

  function renderScan() {
    const rc = receptionCtx ? commandeSuivi(receptionCtx.commandeId) : null;
    if (!rc) receptionCtx = null;
    if (rc) scanMode = "entree";
    app.innerHTML = `
      <div class="scan-wrap">
        <h2 class="view-title">${ico("scan", 24)} Scanner</h2>
        <p class="view-sub">Visez le petit carré <strong>Datamatrix</strong> (ou le code-barres) de la boîte.
        La péremption et le lot se remplissent tout seuls quand le code les contient.</p>
        ${rc ? `<div class="reception-banner">
          <div><strong>📦 Réception de la commande ${esc(rc.numero || "sans n°")}</strong>
            <div class="lot-sub">${esc(nomFournisseurCommande(rc))} · ${resteCommande(rc)} article${resteCommande(rc) > 1 ? "s" : ""} encore attendu${resteCommande(rc) > 1 ? "s" : ""}. Chaque scan valide une ligne.</div></div>
          <button class="btn btn-sm" id="reception-stop">Terminer</button>
        </div>` : ""}
        <div class="scan-mode" ${rc ? "hidden" : ""}>
          <button id="mode-entree" class="entree ${scanMode === "entree" ? "active" : ""}">＋ Entrée en stock</button>
          <button id="mode-sortie" class="sortie ${scanMode === "sortie" ? "active" : ""}">− Sortie du stock</button>
        </div>
        <div id="reader"></div>
        <p class="scan-hint" id="scan-status">Démarrage de la caméra…</p>
        <div class="scan-manual">
          <input id="scan-manual-input" placeholder="…ou saisir / douchette : code puis Entrée" autocomplete="off">
          <button class="btn" id="scan-manual-ok">OK</button>
        </div>
      </div>`;
    document.getElementById("mode-entree").onclick = () => { scanMode = "entree"; renderScan(); };
    document.getElementById("mode-sortie").onclick = () => { scanMode = "sortie"; renderScan(); };
    const stopBtn = document.getElementById("reception-stop");
    if (stopBtn) stopBtn.onclick = () => { const id = receptionCtx.commandeId; receptionCtx = null; switchView("commande", { commandeId: id }); };
    const manual = document.getElementById("scan-manual-input");
    const doManual = () => { const v = manual.value.trim(); if (v) { manual.value = ""; handleScan(v); } };
    manual.onkeydown = (e) => { if (e.key === "Enter") doManual(); };
    document.getElementById("scan-manual-ok").onclick = doManual;
    startScanner();
  }

  async function startScanner() {
    await stopScanner();
    const statusEl = () => document.getElementById("scan-status");
    if (typeof Html5Qrcode === "undefined") {
      if (statusEl()) statusEl().textContent = "Lecteur de codes indisponible (bibliothèque non chargée).";
      return;
    }
    const formats = [
      Html5QrcodeSupportedFormats.DATA_MATRIX,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.CODE_39,
    ];
    try {
      scanner = new Html5Qrcode("reader", {
        formatsToSupport: formats,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        verbose: false,
      });
      const config = {
        fps: 10,
        qrbox: (w, h) => {
          const size = Math.min(300, Math.floor(w * 0.8));
          return { width: size, height: Math.min(size, Math.floor(h * 0.6)) };
        },
      };
      await scanner.start({ facingMode: "environment" }, config,
        (text) => onScanSuccess(text), () => {});
      scannerOn = true;
      if (statusEl()) statusEl().textContent = scanMode === "entree"
        ? "Mode ENTRÉE : chaque scan ajoute au stock."
        : "Mode SORTIE : chaque scan retire du stock.";
    } catch (err) {
      scannerOn = false;
      if (statusEl()) statusEl().innerHTML =
        "⚠ Caméra indisponible (autorisation refusée ou pas de caméra).<br>" +
        "Vous pouvez saisir le code ci-dessous ou utiliser une douchette.";
    }
  }

  async function stopScanner() {
    if (scanner) {
      const s = scanner; scanner = null; scannerOn = false;
      try { await s.stop(); } catch (e) {}
      try { s.clear(); } catch (e) {}
    }
  }

  function pauseScanner() { if (scanner && scannerOn) { try { scanner.pause(true); } catch (e) {} } }
  function resumeScanner() {
    if (view.name === "scan" && scanner && scannerOn) { try { scanner.resume(); } catch (e) {} }
  }

  function onScanSuccess(text) {
    const now = Date.now();
    if (text === lastScanText && now - lastScanTime < 2500) return; // anti-doublon
    lastScanText = text; lastScanTime = now;
    if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) {} }
    handleScan(text);
  }

  function handleScan(text) {
    const parsed = parseGs1(text);
    if (!parsed || !parsed.gtin) { toast("Code illisible."); return; }
    pauseScanner();
    const match = findByGtin(parsed.gtin);
    if (match) {
      if (scanMode === "sortie") openSortieModal(match.p.id, { scanned: parsed, refId: match.r.id });
      else if (receptionCtx) receptionScan(match.p.id, match.r.id, parsed);
      else openEntreeModal(match.p.id, { scanned: parsed, refId: match.r.id });
    } else {
      openAssociateModal(parsed);
    }
  }

  /* =========================================================
     MODALES GÉNÉRIQUES
     ========================================================= */
  const modalRoot = document.getElementById("modal-root");

  function openModal(title, bodyHtml, footHtml) {
    modalRoot.innerHTML = `
      <div class="modal-overlay">
        <div class="modal" role="dialog">
          <div class="modal-head"><h3>${title}</h3><button class="modal-close">✕</button></div>
          <div class="modal-body">${bodyHtml}</div>
          ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ""}
        </div>
      </div>`;
    const overlay = modalRoot.querySelector(".modal-overlay");
    modalRoot.querySelector(".modal-close").onclick = closeModal;
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
  }

  function closeModal() {
    modalRoot.innerHTML = "";
    resumeScanner();
  }

  function stepperHtml(id, val) {
    return `
      <div class="stepper">
        <button type="button" data-step="-1" data-for="${id}">−</button>
        <input id="${id}" type="number" min="1" value="${val}">
        <button type="button" data-step="1" data-for="${id}">＋</button>
      </div>`;
  }
  function bindSteppers() {
    modalRoot.querySelectorAll("[data-step]").forEach(b => b.onclick = () => {
      const inp = document.getElementById(b.dataset.for);
      inp.value = Math.max(1, (Number(inp.value) || 1) + Number(b.dataset.step));
    });
  }

  /* =========================================================
     MODALE : ENTRÉE EN STOCK
     ========================================================= */
  function openEntreeModal(pid, opts) {
    const p = produit(pid); if (!p) return;
    const scanned = opts.scanned || null;
    const refSel = opts.refId || (p.references[0] ? p.references[0].id : "");
    openModal("＋ Entrée — " + esc(p.name), `
      ${scanned ? `<div class="scan-result-prod"><div class="p-name">📷 Code reconnu</div>
        <div class="p-sub">${scanned.peremption ? "péremption " + fmtDate(scanned.peremption) + " · " : ""}${scanned.lot ? "lot " + esc(scanned.lot) : ""}</div></div>` : ""}
      ${opts.hint ? `<div class="scan-result-prod ${opts.hintWarn ? "hint-warn" : ""}"><div class="p-sub">${opts.hint}</div></div>` : ""}
      <div class="form-grid">
        <div class="field full"><label>Quantité (${esc(p.unite)}s)</label>${stepperHtml("en-qty", opts.qty || 1)}</div>
        <div class="field full"><label>Référence commandée</label>
          <select id="en-ref">
            <option value="">— non précisée —</option>
            ${p.references.map(r => {
              const f = fournisseur(r.fournisseurId);
              return `<option value="${r.id}" ${r.id === refSel ? "selected" : ""}>${f ? esc(f.name) : "?"}${r.ref ? " — " + esc(r.ref) : ""}</option>`;
            }).join("")}
          </select></div>
        <div class="field"><label>Date de péremption${scanned && scanned.peremption ? " (remplie par le scan)" : ""}</label>
          <input id="en-perempt" type="date" value="${scanned && scanned.peremption ? scanned.peremption : ""}"></div>
        <div class="field"><label>N° de lot${scanned && scanned.lot ? " (rempli par le scan)" : ""}</label>
          <input id="en-lot" value="${scanned && scanned.lot ? esc(scanned.lot) : ""}"></div>
      </div>`,
      `<button class="btn" data-cancel style="flex:1;justify-content:center">Annuler</button>
       <button class="btn btn-primary" data-ok style="flex:2;justify-content:center">Ajouter au stock</button>`);
    bindSteppers();
    modalRoot.querySelector("[data-cancel]").onclick = closeModal;
    modalRoot.querySelector("[data-ok]").onclick = () => {
      const qty = Math.max(1, Number(document.getElementById("en-qty").value) || 1);
      const refId = document.getElementById("en-ref").value || null;
      const perempt = document.getElementById("en-perempt").value || null;
      const lotNum = document.getElementById("en-lot").value.trim() || null;
      // Fusionne avec un lot identique (même réf, même péremption, même n° de lot)
      const same = p.lots.find(l => l.refId === refId && (l.peremption || null) === perempt && (l.lot || null) === lotNum);
      if (same) same.qty += qty;
      else p.lots.push({ id: uid(), refId, qty, peremption: perempt, lot: lotNum, entree: todayIso() });
      save(); closeModal();
      if (typeof opts.onDone === "function") { opts.onDone(qty); }
      else { render(); toast(`＋${qty} ${p.name} (stock : ${stockTotal(p)})`); }
    };
  }

  /* =========================================================
     MODALE : SORTIE DU STOCK
     ========================================================= */
  function openSortieModal(pid, opts) {
    const p = produit(pid); if (!p) return;
    const lots = lotsFefo(p);
    if (!lots.length) { closeModal(); toast("Stock déjà à zéro pour ce produit."); resumeScanner(); return; }
    // Si un n° de lot a été scanné, on présélectionne le lot correspondant
    let selId = lots[0].id;
    if (opts.scanned && opts.scanned.lot) {
      const m = lots.find(l => (l.lot || "").toLowerCase() === opts.scanned.lot.toLowerCase());
      if (m) selId = m.id;
    }
    openModal("− Sortie — " + esc(p.name), `
      <div class="field full"><label>Quantité à sortir</label>${stepperHtml("so-qty", 1)}</div>
      <div class="field full" style="margin-top:10px"><label>Depuis quel lot ?</label>
        ${lots.map(l => {
          const st = peremptionStatus(p, l);
          return `<label class="check-line">
            <input type="radio" name="so-lot" value="${l.id}" ${l.id === selId ? "checked" : ""}>
            <span>${l.qty} en stock ${l.peremption ? `— <span class="perempt-chip perempt-${st === "past" ? "past" : st === "soon" ? "soon" : "ok"}">exp. ${fmtDate(l.peremption)}</span>` : "— sans péremption"}
            ${l.lot ? " · lot " + esc(l.lot) : ""}</span></label>`;
        }).join("")}
      </div>`,
      `<button class="btn" data-cancel style="flex:1;justify-content:center">Annuler</button>
       <button class="btn btn-primary" data-ok style="flex:2;justify-content:center">Sortir du stock</button>`);
    bindSteppers();
    modalRoot.querySelector("[data-cancel]").onclick = closeModal;
    modalRoot.querySelector("[data-ok]").onclick = () => {
      const qty = Math.max(1, Number(document.getElementById("so-qty").value) || 1);
      const lotId = (modalRoot.querySelector("input[name=so-lot]:checked") || {}).value;
      const first = p.lots.find(l => l.id === lotId);
      if (!first) return;
      // Retire d'abord du lot choisi, puis continue sur les lots
      // qui périment en premier si la quantité dépasse
      const ordre = [first].concat(lotsFefo(p).filter(l => l.id !== first.id));
      let reste = qty, sorti = 0;
      for (const lot of ordre) {
        if (reste <= 0) break;
        const take = Math.min(lot.qty, reste);
        lot.qty -= take; reste -= take; sorti += take;
      }
      p.lots = p.lots.filter(l => l.qty > 0);
      save(); closeModal(); render();
      toast(`−${sorti} ${p.name} (stock : ${stockTotal(p)})${reste > 0 ? " — stock épuisé" : ""}`);
    };
  }

  /* =========================================================
     MODALE : CODE INCONNU → ASSOCIER À UN PRODUIT
     ========================================================= */
  function openAssociateModal(parsed) {
    openModal("Code inconnu", `
      <div class="scan-result-prod">
        <div class="p-name">📷 Premier scan de ce produit</div>
        <div class="p-sub">code ${esc(parsed.gtin)}${parsed.peremption ? " · péremption " + fmtDate(parsed.peremption) : ""}${parsed.lot ? " · lot " + esc(parsed.lot) : ""}</div>
      </div>
      <div id="as-choose">
        <div class="field full"><label>À quel produit correspond-il ?</label>
          <input id="as-search" placeholder="🔍 Tapez quelques lettres pour filtrer…" autocomplete="off"></div>
        <div id="as-list" class="as-list"></div>
        <div class="field full" id="as-ref-wrap" style="margin-top:10px" hidden><label>Référence</label>
          <select id="as-ref"></select>
          <div class="field-hint">Le code sera mémorisé sur cette référence.</div></div>
      </div>
      <div id="as-new" hidden>
        <div class="form-grid">
          <div class="field full"><label>Nom du nouveau produit</label>
            <input id="asn-name" placeholder="ex : Gants taille S"></div>
          <div class="field full"><label>Catégorie</label>
            <select id="asn-cat">${state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>
        </div>
        <p class="field-hint" style="margin-top:8px">Le produit sera créé et le code associé — pensez ensuite à régler
        son stock idéal et son seuil dans sa fiche (⚙️ Réglages).</p>
      </div>`,
      `<button class="btn" data-cancel style="justify-content:center">Ignorer</button>
       <button class="btn" data-new style="flex:1;justify-content:center">＋ Nouveau produit</button>
       <button class="btn btn-primary" data-ok style="flex:1;justify-content:center" disabled>Associer</button>`);

    const searchEl = document.getElementById("as-search");
    const listEl = document.getElementById("as-list");
    const refWrap = document.getElementById("as-ref-wrap");
    const refSel = document.getElementById("as-ref");
    const chooseEl = document.getElementById("as-choose");
    const newEl = document.getElementById("as-new");
    const okBtn = modalRoot.querySelector("[data-ok]");
    const newBtn = modalRoot.querySelector("[data-new]");
    let selectedId = null;
    let modeCreate = false;

    function renderList() {
      const q = searchEl.value.trim().toLowerCase();
      let prods = state.produits.slice().sort((a, b) => a.name.localeCompare(b.name, "fr"));
      if (q) prods = prods.filter(p => p.name.toLowerCase().includes(q) ||
        ((categorie(p.categorieId) || {}).name || "").toLowerCase().includes(q) ||
        p.references.some(r => (r.ref || "").toLowerCase().includes(q) || (r.designation || "").toLowerCase().includes(q)));
      const shown = prods.slice(0, 50);
      listEl.innerHTML = shown.map(p => {
        const c = categorie(p.categorieId);
        return `<button type="button" class="as-item ${p.id === selectedId ? "sel" : ""}" data-pick="${p.id}">
          ${esc(p.name)}<div class="as-cat">${c ? esc(c.name) : ""} · stock ${stockTotal(p)}</div>
        </button>`;
      }).join("") || `<div class="as-cat" style="padding:12px">Aucun produit ne correspond — utilisez « ＋ Nouveau produit ».</div>`;
      if (prods.length > 50) listEl.innerHTML += `<div class="as-cat" style="padding:8px 12px">… ${prods.length - 50} autres : affinez la recherche.</div>`;
      listEl.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => pick(b.dataset.pick));
    }

    function pick(pid) {
      selectedId = pid;
      const p = produit(pid);
      listEl.querySelectorAll(".as-item").forEach(b => b.classList.toggle("sel", b.dataset.pick === pid));
      refSel.innerHTML = p.references.map(r => {
        const f = fournisseur(r.fournisseurId);
        return `<option value="${r.id}">${f ? esc(f.name) : "?"}${r.ref ? " — " + esc(r.ref) : ""}${r.designation ? " — " + esc(r.designation) : ""}</option>`;
      }).join("") + `<option value="__new__">＋ Nouvelle référence…</option>`;
      refWrap.hidden = false;
      okBtn.disabled = false;
    }

    searchEl.oninput = renderList;
    renderList();
    setTimeout(() => { try { searchEl.focus(); } catch (e) {} }, 60);

    newBtn.onclick = () => {
      modeCreate = !modeCreate;
      chooseEl.hidden = modeCreate;
      newEl.hidden = !modeCreate;
      newBtn.textContent = modeCreate ? "← Produit existant" : "＋ Nouveau produit";
      okBtn.textContent = modeCreate ? "Créer et associer" : "Associer";
      if (modeCreate) {
        const nameEl = document.getElementById("asn-name");
        if (!nameEl.value) nameEl.value = searchEl.value.trim();
        okBtn.disabled = false;
        setTimeout(() => { try { nameEl.focus(); } catch (e) {} }, 60);
      } else {
        okBtn.disabled = !selectedId;
      }
    };

    modalRoot.querySelector("[data-cancel]").onclick = closeModal;
    okBtn.onclick = () => {
      let p, refId;
      if (modeCreate) {
        const name = document.getElementById("asn-name").value.trim();
        if (!name) { toast("Donnez un nom au produit."); return; }
        p = {
          id: uid(), categorieId: document.getElementById("asn-cat").value, name,
          unite: "boîte", stockIdeal: 0, seuilMini: 0,
          alertePeremption: false, delaiAlerteMois: 3, enCave: false, note: "",
          references: [], lots: [],
        };
        state.produits.push(p);
        const r = { id: uid(), fournisseurId: "", ref: "", designation: "", url: "", prix: "", note: "", gtins: [parsed.gtin] };
        p.references.push(r); refId = r.id;
        toast("Produit créé — réglez son stock idéal dans sa fiche quand vous aurez un moment.");
      } else {
        p = produit(selectedId); if (!p) return;
        refId = refSel.value;
        if (refId === "__new__" || !refId) {
          const r = { id: uid(), fournisseurId: "", ref: "", designation: "", url: "", prix: "", note: "", gtins: [parsed.gtin] };
          p.references.push(r); refId = r.id;
          toast("Référence créée — complétez-la dans la fiche produit.");
        } else {
          const r = reference(p, refId);
          if (r && !r.gtins.some(g => normGtin(g) === normGtin(parsed.gtin))) r.gtins.push(parsed.gtin);
        }
      }
      save();
      closeModal();
      if (scanMode === "sortie") openSortieModal(p.id, { scanned: parsed, refId });
      else if (receptionCtx) receptionScan(p.id, refId, parsed);
      else openEntreeModal(p.id, { scanned: parsed, refId });
    };
  }

  /* =========================================================
     MODALES : PRODUIT / CATÉGORIE / RÉFÉRENCE / FOURNISSEUR
     ========================================================= */
  function openProduitModal() {
    if (!state.categories.length) { toast("Créez d'abord une catégorie."); openCategorieModal(null); return; }
    openModal("＋ Nouveau produit", `
      <div class="form-grid">
        <div class="field full"><label>Nom du produit *</label>
          <input id="np-name" placeholder="ex : Gants latex taille S"></div>
        <div class="field"><label>Catégorie</label>
          <select id="np-cat">${state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Unité</label>
          <input id="np-unite" value="boîte"></div>
        <div class="field"><label>Stock idéal</label>
          <input id="np-ideal" type="number" min="0" placeholder="ex : 4"></div>
        <div class="field"><label>Seuil mini (commande)</label>
          <input id="np-seuil" type="number" min="0" placeholder="ex : 2"></div>
        <div class="field full">
          <div class="check-line"><input type="checkbox" id="np-alerte"><span>Alerter avant péremption</span></div>
        </div>
      </div>`,
      `<button class="btn" data-cancel style="flex:1;justify-content:center">Annuler</button>
       <button class="btn btn-primary" data-ok style="flex:2;justify-content:center">Créer le produit</button>`);
    modalRoot.querySelector("[data-cancel]").onclick = closeModal;
    document.getElementById("np-name").focus();
    modalRoot.querySelector("[data-ok]").onclick = () => {
      const name = document.getElementById("np-name").value.trim();
      if (!name) { toast("Le nom est obligatoire."); return; }
      const p = {
        id: uid(), categorieId: document.getElementById("np-cat").value, name,
        unite: document.getElementById("np-unite").value.trim() || "boîte",
        stockIdeal: num(document.getElementById("np-ideal").value),
        seuilMini: num(document.getElementById("np-seuil").value),
        alertePeremption: document.getElementById("np-alerte").checked,
        delaiAlerteMois: 3, note: "", references: [], lots: [],
      };
      state.produits.push(p);
      save(); closeModal();
      switchView("fiche", { produitId: p.id, ficheTab: "refs" });
      toast("Produit créé — ajoutez ses références fournisseurs.");
    };
  }

  function openCategorieModal(catId) {
    const c = catId ? categorie(catId) : null;
    openModal(c ? "Renommer la catégorie" : "＋ Nouvelle catégorie", `
      <div class="field full"><label>Nom de la catégorie</label>
        <input id="nc-name" value="${c ? esc(c.name) : ""}" placeholder="ex : Gants"></div>`,
      `<button class="btn" data-cancel style="flex:1;justify-content:center">Annuler</button>
       <button class="btn btn-primary" data-ok style="flex:2;justify-content:center">${c ? "Renommer" : "Créer"}</button>`);
    modalRoot.querySelector("[data-cancel]").onclick = closeModal;
    const inp = document.getElementById("nc-name");
    inp.focus();
    const doSave = () => {
      const name = inp.value.trim();
      if (!name) { toast("Le nom est obligatoire."); return; }
      if (c) c.name = name;
      else state.categories.push({ id: uid(), name });
      save(); closeModal(); render();
    };
    inp.onkeydown = (e) => { if (e.key === "Enter") doSave(); };
    modalRoot.querySelector("[data-ok]").onclick = doSave;
  }

  function openRefModal(pid, refId) {
    const p = produit(pid); if (!p) return;
    const r = refId ? reference(p, refId) : null;
    openModal(r ? "Modifier la référence" : "＋ Référence fournisseur", `
      <div class="form-grid">
        <div class="field full"><label>Fournisseur</label>
          <select id="nr-fourn">
            <option value="">— choisir —</option>
            ${state.fournisseurs.map(f => `<option value="${f.id}" ${r && r.fournisseurId === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}
          </select>
          <div class="field-hint">Fournisseur manquant ? Ajoutez-le dans ⚙️ Réglages.</div></div>
        <div class="field"><label>Référence produit</label>
          <input id="nr-ref" value="${r ? esc(r.ref) : ""}" placeholder="ex : 258-9665"></div>
        <div class="field"><label>Prix indicatif (€)</label>
          <input id="nr-prix" value="${r ? esc(r.prix || "") : ""}" placeholder="facultatif"></div>
        <div class="field full"><label>Désignation (nom affiché)</label>
          <input id="nr-desig" value="${r ? esc(r.designation || "") : ""}" placeholder="facultatif — corrigez ici un nom bizarre issu d'un scan"></div>
        ${r ? `<div class="field full"><label>Rattachée au produit</label>
          <select id="nr-prod">${state.produits.slice().sort((a, b) => a.name.localeCompare(b.name, "fr")).map(x =>
            `<option value="${x.id}" ${x.id === p.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
          <div class="field-hint">Changez de produit pour déplacer cette référence — ses codes scannés et ses lots en stock suivent.</div></div>` : ""}
        <div class="field full"><label>Lien vers la page produit</label>
          <input id="nr-url" type="url" value="${r ? esc(r.url || "") : ""}" placeholder="https://…">
          <div class="field-hint">Ce lien apparaîtra dans la liste de courses pour commander en 1 clic.</div></div>
        <div class="field full"><label>Note</label>
          <input id="nr-note" value="${r ? esc(r.note || "") : ""}" placeholder="facultatif"></div>
      </div>`,
      `${r ? '<button class="btn btn-danger" data-del>🗑</button>' : ""}
       <button class="btn" data-cancel style="flex:1;justify-content:center">Annuler</button>
       <button class="btn btn-primary" data-ok style="flex:2;justify-content:center">Enregistrer</button>`);
    modalRoot.querySelector("[data-cancel]").onclick = closeModal;
    if (r) modalRoot.querySelector("[data-del]").onclick = () => {
      if (!confirm("Supprimer cette référence ?")) return;
      p.references = p.references.filter(x => x.id !== r.id);
      p.lots.forEach(l => { if (l.refId === r.id) l.refId = null; });
      save(); closeModal(); render();
    };
    modalRoot.querySelector("[data-ok]").onclick = () => {
      const data = {
        fournisseurId: document.getElementById("nr-fourn").value,
        ref: document.getElementById("nr-ref").value.trim(),
        prix: document.getElementById("nr-prix").value.trim(),
        designation: document.getElementById("nr-desig").value.trim(),
        url: document.getElementById("nr-url").value.trim(),
        note: document.getElementById("nr-note").value.trim(),
      };
      if (r) {
        Object.assign(r, data);
        // Déplacement éventuel vers un autre produit (codes + lots liés suivent)
        const prodSel = document.getElementById("nr-prod");
        const targetId = prodSel ? prodSel.value : p.id;
        if (targetId !== p.id) {
          const t = produit(targetId);
          if (t) {
            p.references = p.references.filter(x => x.id !== r.id);
            t.references.push(r);
            const moved = p.lots.filter(l => l.refId === r.id);
            p.lots = p.lots.filter(l => l.refId !== r.id);
            t.lots.push(...moved);
            save(); closeModal();
            switchView("fiche", { produitId: t.id, ficheTab: "refs" });
            toast(`Référence déplacée vers « ${t.name} »${moved.length ? " (avec " + moved.reduce((s, l) => s + l.qty, 0) + " en stock)" : ""}.`);
            return;
          }
        }
      } else {
        p.references.push(Object.assign({ id: uid(), gtins: [] }, data));
      }
      save(); closeModal(); render();
    };
  }

  function openFournisseurModal(fid) {
    const f = fid ? fournisseur(fid) : null;
    openModal(f ? "Modifier le fournisseur" : "＋ Fournisseur", `
      <div class="form-grid">
        <div class="field full"><label>Nom *</label>
          <input id="nf-name" value="${f ? esc(f.name) : ""}" placeholder="ex : GACD"></div>
        <div class="field full"><label>Site internet</label>
          <input id="nf-url" type="url" value="${f ? esc(f.url || "") : ""}" placeholder="https://…"></div>
        <div class="field full"><label>Note (code client, frais de port offerts dès…, etc.)</label>
          <textarea id="nf-note" placeholder="ex : franco de port dès 99 € — code client 10132986">${f ? esc(f.note || "") : ""}</textarea></div>
      </div>`,
      `${f ? '<button class="btn btn-danger" data-del>🗑</button>' : ""}
       <button class="btn" data-cancel style="flex:1;justify-content:center">Annuler</button>
       <button class="btn btn-primary" data-ok style="flex:2;justify-content:center">Enregistrer</button>`);
    modalRoot.querySelector("[data-cancel]").onclick = closeModal;
    if (f) modalRoot.querySelector("[data-del]").onclick = () => {
      const used = state.produits.some(p => p.references.some(r => r.fournisseurId === f.id));
      if (used) { toast("Impossible : ce fournisseur est utilisé par des références."); return; }
      if (!confirm("Supprimer ce fournisseur ?")) return;
      state.fournisseurs = state.fournisseurs.filter(x => x.id !== f.id);
      save(); closeModal(); render();
    };
    modalRoot.querySelector("[data-ok]").onclick = () => {
      const name = document.getElementById("nf-name").value.trim();
      if (!name) { toast("Le nom est obligatoire."); return; }
      const data = {
        name,
        url: document.getElementById("nf-url").value.trim(),
        note: document.getElementById("nf-note").value.trim(),
      };
      if (f) Object.assign(f, data);
      else state.fournisseurs.push(Object.assign({ id: uid() }, data));
      save(); closeModal(); render();
    };
  }

  /* =========================================================
     VUE : LISTE DE COURSES
     ========================================================= */
  function renderCourses() {
    const { besoin, enAttente } = aCommander();
    let html = `
      <h2 class="view-title">${ico("cart", 24)} Liste de courses</h2>
      <p class="view-sub">Générée automatiquement dès qu'un stock passe sous son seuil mini.</p>`;

    if (!besoin.length && !enAttente.length) {
      html += `<div class="empty-note">Rien à commander : tous les stocks sont au-dessus de leur seuil. 🎉</div>`;
    }

    if (besoin.length) {
      html += `<div class="section-label">À commander (${besoin.length})</div>`;
      besoin.forEach(({ p, qty }) => {
        const t = stockTotal(p);
        html += `
          <div class="course-row">
            <div class="course-top">
              <span class="course-name" data-goto="${p.id}" style="cursor:pointer">${esc(p.name)}</span>
              <span class="lot-sub">stock ${t} / idéal ${p.stockIdeal || "?"}</span>
              <span class="course-need">→ ${qty} ${esc(p.unite)}${qty > 1 ? "s" : ""}</span>
              <button class="btn btn-sm" data-cmd="${p.id}" title="J'ai passé la commande">✔ Commandé</button>
            </div>
            ${courseLinks(p)}
          </div>`;
      });
    }

    if (enAttente.length) {
      html += `<div class="section-label">Commandé — en attente de réception (${enAttente.length})</div>`;
      enAttente.forEach(({ p }) => {
        const c = state.commandes[p.id] || {};
        html += `
          <div class="course-row course-done">
            <div class="course-top">
              <span class="course-name">${esc(p.name)}</span>
              <span class="lot-sub">commandé le ${fmtDate(c.date || todayIso())}</span>
              <button class="btn btn-sm" data-uncmd="${p.id}">↩ Pas encore commandé</button>
            </div>
            <div class="lot-sub" style="margin-top:6px">Scannez les boîtes à réception : elles sortiront de cette liste automatiquement.</div>
          </div>`;
      });
    }

    html += `
      <div class="section-label">Autres courses (à la main)</div>
      <div class="card">
        ${state.coursesManuelles.map(c => `
          <label class="manual-item">
            <input type="checkbox" data-man-check="${c.id}" ${c.done ? "checked" : ""}>
            <span class="${c.done ? "checked" : ""}">${esc(c.texte)}</span>
            <button class="btn btn-sm btn-danger" data-man-del="${c.id}">✕</button>
          </label>`).join("") || '<div class="lot-sub" style="padding:4px 0 10px">Ajoutez ici ce qui n\'est pas suivi en stock (papeterie, café…).</div>'}
        <div class="scan-manual" style="margin-top:8px">
          <input id="man-input" placeholder="Ajouter une course…">
          <button class="btn" id="man-add">＋</button>
        </div>
      </div>`;

    app.innerHTML = html;

    app.querySelectorAll("[data-goto]").forEach(el => el.onclick = () =>
      switchView("fiche", { produitId: el.dataset.goto, ficheTab: "refs" }));
    app.querySelectorAll("[data-cmd]").forEach(b => b.onclick = () => {
      state.commandes[b.dataset.cmd] = { date: todayIso() };
      save(); render();
    });
    app.querySelectorAll("[data-uncmd]").forEach(b => b.onclick = () => {
      delete state.commandes[b.dataset.uncmd];
      save(); render();
    });
    const manInput = document.getElementById("man-input");
    const addMan = () => {
      const v = manInput.value.trim();
      if (!v) return;
      state.coursesManuelles.push({ id: uid(), texte: v, done: false });
      save(); render();
    };
    document.getElementById("man-add").onclick = addMan;
    manInput.onkeydown = (e) => { if (e.key === "Enter") addMan(); };
    app.querySelectorAll("[data-man-check]").forEach(cb => cb.onchange = () => {
      const c = state.coursesManuelles.find(x => x.id === cb.dataset.manCheck);
      if (c) { c.done = cb.checked; save(); render(); }
    });
    app.querySelectorAll("[data-man-del]").forEach(b => b.onclick = (e) => {
      e.preventDefault();
      state.coursesManuelles = state.coursesManuelles.filter(x => x.id !== b.dataset.manDel);
      save(); render();
    });
  }

  function courseLinks(p) {
    const links = [];
    p.references.forEach(r => {
      const f = fournisseur(r.fournisseurId);
      const url = r.url || (f && f.url) || "";
      if (!url) return;
      const label = (f ? f.name : "Fournisseur") + (r.prix ? " · " + r.prix + " €" : "");
      links.push(`<a class="link-btn" href="${esc(url)}" target="_blank" rel="noopener">🔗 ${esc(label)}</a>`);
    });
    if (!links.length) return `<div class="lot-sub" style="margin-top:6px">Aucun lien fournisseur — ajoutez-en dans la fiche produit (onglet Références).</div>`;
    return `<div class="course-links">${links.join("")}</div>`;
  }

  /* =========================================================
     VUE : PÉREMPTIONS
     ========================================================= */
  function renderPeremption() {
    const { past, soon } = alertesPeremption();
    let html = `
      <h2 class="view-title">${ico("clock", 24)} Alertes péremption</h2>
      <p class="view-sub">Concerne les produits où l'alerte est activée (fiche produit → Réglages),
      plus tout lot déjà périmé.</p>`;

    if (!past.length && !soon.length) {
      html += `<div class="empty-note">Aucune alerte : rien de périmé ni de bientôt périmé. 🎉</div>`;
    }

    const bloc = (items, title, cls) => {
      if (!items.length) return "";
      let h = `<div class="section-label">${title} (${items.length})</div>`;
      items.forEach(({ p, l }) => {
        h += `
          <div class="course-row">
            <div class="course-top">
              <span class="course-name" data-goto="${p.id}" style="cursor:pointer">${esc(p.name)}</span>
              <span class="perempt-chip ${cls}">${cls === "perempt-past" ? "périmé " : "exp. "}${fmtDate(l.peremption)}</span>
              <span class="lot-sub">${l.qty} ${esc(p.unite)}${l.qty > 1 ? "s" : ""}${l.lot ? " · lot " + esc(l.lot) : ""}</span>
              <button class="btn btn-sm btn-danger" data-out="${p.id}|${l.id}">Sortir du stock</button>
            </div>
          </div>`;
      });
      return h;
    };
    html += bloc(past, "Périmés — à jeter", "perempt-past");
    html += bloc(soon, "Bientôt périmés — à utiliser en premier", "perempt-soon");

    app.innerHTML = html;
    app.querySelectorAll("[data-goto]").forEach(el => el.onclick = () =>
      switchView("fiche", { produitId: el.dataset.goto }));
    app.querySelectorAll("[data-out]").forEach(b => b.onclick = () => {
      const [pid, lid] = b.dataset.out.split("|");
      const p = produit(pid); if (!p) return;
      if (!confirm("Sortir tout ce lot du stock ?")) return;
      p.lots = p.lots.filter(l => l.id !== lid);
      save(); render(); toast("Lot sorti du stock.");
    });
  }

  /* =========================================================
     SUIVI DES COMMANDES
     state.commandesSuivi : [{ id, numero, date, fournisseurId,
       fournisseurNom, total, fraisPort, statut, source, mailId,
       mailSujet, note, creeLe, archiveeLe,
       lignes: [{ id, designation, ref, produitId, refId, qty, prix, recu }] }]
     Le stock (produits / lots) n'est modifié QUE par la fenêtre
     « Entrée en stock » habituelle, ligne par ligne, à la réception.
     ========================================================= */
  function commandeSuivi(id) { return state.commandesSuivi.find(c => c.id === id) || null; }

  function statutCommande(c) {
    if (c.statut === "archivee") return "archivee";
    if (!c.lignes.length) return "attente";
    const complete = c.lignes.every(l => l.recu >= l.qty);
    if (complete) return "recue";
    return c.lignes.some(l => l.recu > 0) ? "partielle" : "attente";
  }
  function resteCommande(c) { return c.lignes.reduce((t, l) => t + Math.max(0, l.qty - l.recu), 0); }
  function reliquats(c) { return c.lignes.filter(l => l.recu < l.qty); }
  function nomFournisseurCommande(c) {
    const f = c.fournisseurId ? fournisseur(c.fournisseurId) : null;
    return f ? f.name : (c.fournisseurNom || "Fournisseur ?");
  }
  function montantCommande(c) {
    if (c.total > 0) return c.total;
    return c.lignes.reduce((t, l) => t + l.qty * l.prix, 0) + (c.fraisPort || 0);
  }
  function parsePrix(v) {
    if (typeof v === "number") return isFinite(v) && v > 0 ? v : 0;
    const s = String(v || "").replace(/\s/g, "").replace("€", "").replace(",", ".");
    const n = parseFloat(s);
    return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  }
  function fmtEur(n) {
    n = Number(n) || 0;
    return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }
  const STATUT_LABEL = { attente: "En attente de livraison", partielle: "Partiellement reçue", recue: "Tout est arrivé", archivee: "Archivée" };
  const STATUT_ICON = { attente: "🕒", partielle: "⚠", recue: "✔", archivee: "📁" };

  // Marque les produits de la commande « commandés » dans la liste de courses
  function marquerCommandesCourses(c) {
    c.lignes.forEach(l => {
      if (l.produitId && produit(l.produitId) && !state.commandes[l.produitId]) state.commandes[l.produitId] = { date: c.date };
    });
  }

  /* ---- Historique des prix (issu des commandes) ---- */
  // Dernier prix connu pour une référence ou un produit (tri par date décroissante)
  function lignesPrix() {
    const out = [];
    state.commandesSuivi.forEach(c => c.lignes.forEach(l => {
      if (l.prix > 0 && l.produitId) out.push({ date: c.date, produitId: l.produitId, refId: l.refId, prix: l.prix, commande: c });
    }));
    out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return out;
  }
  function prixUnitaire(p, lot, cache) {
    const hist = cache || lignesPrix();
    if (lot && lot.refId) {
      const h = hist.find(x => x.refId === lot.refId);
      if (h) return { prix: h.prix, src: "commande" };
      const r = reference(p, lot.refId);
      if (r && parsePrix(r.prix)) return { prix: parsePrix(r.prix), src: "indicatif" };
    }
    const hp = hist.find(x => x.produitId === p.id);
    if (hp) return { prix: hp.prix, src: "commande" };
    const r2 = p.references.find(r => parsePrix(r.prix));
    if (r2) return { prix: parsePrix(r2.prix), src: "indicatif" };
    return null;
  }

  /* =========================================================
     VUE : COMMANDES (liste)
     ========================================================= */
  function renderCommandes() {
    const enCours = state.commandesSuivi.filter(c => c.statut !== "archivee")
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const archivees = state.commandesSuivi.filter(c => c.statut === "archivee")
      .sort((a, b) => ((a.archiveeLe || a.date) < (b.archiveeLe || b.date) ? 1 : -1));
    const gmailOk = !!(state.gmail && state.gmail.clientId);

    let html = `
      <h2 class="view-title">${ico("truck", 24)} Commandes</h2>
      <p class="view-sub">Suivi des commandes fournisseurs : réception par scan, reliquats, dépenses et valeur du stock.</p>
      <div class="fiche-tabs">
        <button class="fiche-tab ${cmdTab === "encours" ? "active" : ""}" data-ctab="encours">✉ En cours (${enCours.length})</button>
        <button class="fiche-tab ${cmdTab === "archivees" ? "active" : ""}" data-ctab="archivees">📁 Archivées (${archivees.length})</button>
        <button class="fiche-tab ${cmdTab === "finances" ? "active" : ""}" data-ctab="finances">€ Dépenses & valeur</button>
      </div>`;

    if (cmdTab === "finances") {
      html += renderFinances();
    } else {
      html += `
        <div class="toolbar">
          <button class="btn btn-primary btn-sm" id="cmd-new">＋ Nouvelle commande</button>
          <button class="btn btn-sm" id="cmd-paste">✉ Coller un mail de commande</button>
          <button class="btn btn-sm" id="cmd-gmail" title="${gmailOk ? "Chercher les mails de commande dans la boîte Gmail" : "À configurer dans ⚙️ Réglages"}">✉ Vérifier mes mails${gmailOk ? "" : " (à configurer)"}</button>
        </div>`;
      const list = cmdTab === "encours" ? enCours : archivees;
      if (!list.length) {
        html += `<div class="empty-note">${cmdTab === "encours"
          ? "Aucune commande en cours. Créez-en une, collez le mail de confirmation du fournisseur, ou lancez la vérification des mails."
          : "Aucune commande archivée pour le moment."}</div>`;
      }
      // En cours : d'abord ce qui demande une action (reçues à archiver, partielles), puis en attente
      const ordre = { recue: 0, partielle: 1, attente: 2, archivee: 3 };
      list.slice().sort((a, b) => cmdTab === "encours" ? (ordre[a.statut] - ordre[b.statut]) || (a.date < b.date ? 1 : -1) : 0)
        .forEach(c => { html += commandeCard(c); });
    }

    app.innerHTML = html;
    app.querySelectorAll("[data-ctab]").forEach(b => b.onclick = () => { cmdTab = b.dataset.ctab; render(); });
    const bNew = document.getElementById("cmd-new");
    if (bNew) bNew.onclick = () => openCommandeModal(null);
    const bPaste = document.getElementById("cmd-paste");
    if (bPaste) bPaste.onclick = openCollerMailModal;
    const bGmail = document.getElementById("cmd-gmail");
    if (bGmail) bGmail.onclick = () => { if (gmailOk) gmailVerifier({ manuel: true }); else openGmailAideModal(); };
    app.querySelectorAll("[data-open-cmd]").forEach(el => el.onclick = () => switchView("commande", { commandeId: el.dataset.openCmd }));
    bindFinances();
  }

  function commandeCard(c) {
    const reste = resteCommande(c), total = c.lignes.reduce((t, l) => t + l.qty, 0);
    const rel = reliquats(c);
    return `
      <div class="cmd-card cmd-${c.statut}" data-open-cmd="${c.id}">
        <div class="cmd-top">
          <span class="cmd-icon">${STATUT_ICON[c.statut]}</span>
          <div class="grow">
            <div class="cmd-title">${esc(nomFournisseurCommande(c))} <span class="cmd-num">${c.numero ? "n° " + esc(c.numero) : "sans n°"}</span></div>
            <div class="lot-sub">${fmtDate(c.date)} · ${c.lignes.length} ligne${c.lignes.length > 1 ? "s" : ""} · ${fmtEur(montantCommande(c))}${c.source === "mail" ? " · ✉" : ""}</div>
          </div>
          <span class="cmd-statut">${STATUT_LABEL[c.statut]}</span>
        </div>
        ${c.statut === "partielle" ? `<div class="cmd-reliquat">Reliquat : ${reste}/${total} article${reste > 1 ? "s" : ""} — ${rel.slice(0, 3).map(l => esc(l.designation || nomLigne(l))).join(", ")}${rel.length > 3 ? "…" : ""}</div>` : ""}
        ${c.statut === "recue" ? `<div class="cmd-reliquat ok">Tout est arrivé — pensez à archiver.</div>` : ""}
      </div>`;
  }
  function nomLigne(l) {
    if (l.designation) return l.designation;
    const p = l.produitId ? produit(l.produitId) : null;
    return p ? p.name : (l.ref ? "réf " + l.ref : "Article");
  }

  /* =========================================================
     VUE : DÉTAIL D'UNE COMMANDE (réception)
     ========================================================= */
  function renderCommandeDetail() {
    const c = commandeSuivi(view.commandeId);
    if (!c) { switchView("commandes"); return; }
    const rel = reliquats(c);
    const totalQty = c.lignes.reduce((t, l) => t + l.qty, 0);
    const recuQty = c.lignes.reduce((t, l) => t + Math.min(l.recu, l.qty), 0);

    const ligneHtml = (l, isRel) => {
      const p = l.produitId ? produit(l.produitId) : null;
      const reste = Math.max(0, l.qty - l.recu);
      const done = reste === 0;
      return `
        <div class="cmd-line ${done ? "done" : ""} ${isRel ? "rel" : ""}">
          <div class="cmd-line-qty">${l.recu}/${l.qty}</div>
          <div class="grow">
            <div class="cmd-line-name">${esc(nomLigne(l))}</div>
            <div class="lot-sub">${l.ref ? "réf " + esc(l.ref) + " · " : ""}${l.prix ? fmtEur(l.prix) + " l'unité" : "prix inconnu"}
              ${p ? ` · <span data-goto="${p.id}" style="cursor:pointer;text-decoration:underline">${esc(p.name)}</span> (stock ${stockTotal(p)})` : ` · <span class="cmd-unlinked">non lié à un produit</span>`}</div>
          </div>
          ${c.statut === "archivee" ? "" : `
          <div class="qty-btns">
            ${!done ? `<button class="btn btn-sm btn-primary" data-recu="${l.id}" title="Valider la réception de cette ligne">✔ Reçu</button>` : `<button class="btn btn-sm" data-unrecu="${l.id}" title="Annuler la réception (le stock n'est pas modifié)">↩</button>`}
          </div>`}
        </div>`;
    };

    let html = `
      <div class="fiche-head">
        <button class="fiche-back" id="cmd-back" title="Retour">←</button>
        <div style="flex:1">
          <h2>${esc(nomFournisseurCommande(c))} ${c.numero ? `<span class="cmd-num">n° ${esc(c.numero)}</span>` : ""}</h2>
          <div class="prod-meta">${fmtDate(c.date)} · ${fmtEur(montantCommande(c))}${c.fraisPort ? " (dont port " + fmtEur(c.fraisPort) + ")" : ""} ·
            <span class="cmd-statut cmd-statut-${c.statut}">${STATUT_ICON[c.statut]} ${STATUT_LABEL[c.statut]}</span></div>
        </div>
      </div>
      ${c.statut !== "archivee" ? `
      <div class="toolbar">
        <button class="btn btn-primary" id="cmd-scan" ${rel.length ? "" : "disabled"}>📷 Scanner la réception</button>
        <button class="btn" id="cmd-edit">✎ Modifier</button>
        ${c.statut === "recue" ? `<button class="btn" id="cmd-archive">📁 Archiver</button>` : ""}
        <button class="btn btn-danger btn-sm" id="cmd-del" style="margin-left:auto">🗑</button>
      </div>
      <div class="cmd-progress"><div style="width:${totalQty ? Math.round(recuQty / totalQty * 100) : 0}%"></div></div>
      <div class="lot-sub" style="margin:-6px 0 12px">${recuQty} / ${totalQty} article${totalQty > 1 ? "s" : ""} reçu${recuQty > 1 ? "s" : ""}</div>` : `
      <div class="toolbar">
        <button class="btn" id="cmd-unarchive">↩ Sortir des archives</button>
        <button class="btn btn-danger btn-sm" id="cmd-del" style="margin-left:auto">🗑</button>
      </div>`}`;

    if (c.statut === "partielle" && rel.length) {
      html += `<div class="card card-warn"><h4>⚠ Reliquat — encore attendu (${rel.length})</h4>
        ${rel.map(l => ligneHtml(l, true)).join("")}</div>`;
    }
    html += `<div class="card"><h4>Articles commandés (${c.lignes.length})</h4>
      ${c.lignes.length ? c.lignes.map(l => ligneHtml(l, false)).join("") : '<div class="lot-sub" style="padding:8px 0">Aucune ligne — cliquez sur « ✎ Modifier » pour en ajouter.</div>'}
    </div>`;
    if (c.note || c.mailSujet) html += `<div class="card"><h4>Note</h4><div class="lot-sub" style="white-space:pre-wrap">${c.mailSujet ? "✉ " + esc(c.mailSujet) + "\n" : ""}${esc(c.note || "")}</div></div>`;

    app.innerHTML = html;
    document.getElementById("cmd-back").onclick = () => switchView("commandes");
    app.querySelectorAll("[data-goto]").forEach(el => el.onclick = () => switchView("fiche", { produitId: el.dataset.goto }));
    const q = (id) => document.getElementById(id);
    if (q("cmd-scan")) q("cmd-scan").onclick = () => { receptionCtx = { commandeId: c.id }; switchView("scan"); };
    if (q("cmd-edit")) q("cmd-edit").onclick = () => openCommandeModal(c);
    if (q("cmd-archive")) q("cmd-archive").onclick = () => archiverCommande(c);
    if (q("cmd-unarchive")) q("cmd-unarchive").onclick = () => { c.statut = "attente"; c.statut = statutCommande(c); delete c.archiveeLe; save(); render(); };
    if (q("cmd-del")) q("cmd-del").onclick = () => {
      if (!confirm("Supprimer cette commande du suivi ?\n(Le stock déjà entré n'est pas modifié.)")) return;
      state.commandesSuivi = state.commandesSuivi.filter(x => x.id !== c.id);
      save(); switchView("commandes"); toast("Commande supprimée.");
    };
    app.querySelectorAll("[data-recu]").forEach(b => b.onclick = () => recevoirLigne(c, b.dataset.recu, null));
    app.querySelectorAll("[data-unrecu]").forEach(b => b.onclick = () => {
      const l = c.lignes.find(x => x.id === b.dataset.unrecu); if (!l) return;
      l.recu = 0; c.statut = statutCommande(c); save(); render();
    });
  }

  // Réception d'une ligne : si liée à un produit → fenêtre d'entrée en stock
  // habituelle (quantité pré-remplie = reste attendu) ; sinon simple validation.
  function recevoirLigne(c, ligneId, scanned) {
    const l = c.lignes.find(x => x.id === ligneId); if (!l) return;
    const reste = Math.max(0, l.qty - l.recu);
    const p = l.produitId ? produit(l.produitId) : null;
    const apres = (qty) => {
      l.recu = Math.min(l.qty, l.recu + qty);
      c.statut = statutCommande(c);
      save();
      if (c.statut === "recue") proposerArchivage(c);
      else { render(); toast(`✔ ${nomLigne(l)} — ${l.recu}/${l.qty} reçu${l.recu > 1 ? "s" : ""}`); }
    };
    if (p) {
      const refOk = l.refId && reference(p, l.refId) ? l.refId : (p.references[0] ? p.references[0].id : null);
      openEntreeModal(p.id, {
        scanned, refId: refOk, qty: reste || 1,
        hint: `🚚 Commande ${esc(c.numero || "")} — ${reste} attendu${reste > 1 ? "s" : ""} sur cette ligne. La quantité saisie entre en stock et valide la réception.`,
        onDone: apres,
      });
    } else {
      apres(reste);
    }
  }

  // Scan pendant une réception : retrouve la ligne correspondante
  function receptionScan(pid, refId, parsed) {
    const c = receptionCtx ? commandeSuivi(receptionCtx.commandeId) : null;
    if (!c) { receptionCtx = null; openEntreeModal(pid, { scanned: parsed, refId }); return; }
    const cand = c.lignes.filter(l => l.produitId === pid && l.recu < l.qty);
    const l = cand.find(x => x.refId === refId) || cand[0];
    if (l) { recevoirLigne(c, l.id, parsed); return; }
    const p = produit(pid);
    const deja = c.lignes.some(x => x.produitId === pid);
    openEntreeModal(pid, {
      scanned: parsed, refId, hintWarn: true,
      hint: deja ? `⚠ Cette ligne de la commande ${esc(c.numero || "")} est déjà entièrement reçue. L'entrée sera ajoutée au stock hors commande.`
                 : `⚠ « ${esc(p ? p.name : "?")} » ne figure pas dans la commande ${esc(c.numero || "")}. L'entrée sera ajoutée au stock hors commande.`,
      onDone: () => { render(); toast("Entrée hors commande ajoutée au stock."); },
    });
  }

  function proposerArchivage(c) {
    openModal("🎉 Tout est arrivé !", `
      <p style="margin-bottom:10px">Tous les articles de la commande <strong>${esc(nomFournisseurCommande(c))}${c.numero ? " n° " + esc(c.numero) : ""}</strong> ont été reçus.</p>
      <p class="lot-sub">On l'archive ? Elle restera consultable dans « Archivées » et comptera dans les dépenses.</p>`,
      `<button class="btn" data-later style="flex:1;justify-content:center">Plus tard</button>
       <button class="btn btn-primary" data-ok style="flex:2;justify-content:center">📁 Archiver</button>`);
    modalRoot.querySelector("[data-later]").onclick = () => { closeModal(); render(); };
    modalRoot.querySelector("[data-ok]").onclick = () => { closeModal(); archiverCommande(c); };
  }
  function archiverCommande(c) {
    c.statut = "archivee"; c.archiveeLe = todayIso();
    receptionCtx = null;
    save(); switchView("commandes"); toast("Commande archivée.");
  }

  /* =========================================================
     MODALE : CRÉER / MODIFIER UNE COMMANDE
     draft = commande existante (état) ou brouillon issu d'un mail
     ========================================================= */
  function openCommandeModal(existing, draft) {
    const c = existing || Object.assign({
      id: uid(), numero: "", date: todayIso(), fournisseurId: "", fournisseurNom: "", total: 0, fraisPort: 0,
      statut: "attente", source: "manuel", mailId: null, mailSujet: "", note: "", creeLe: todayIso(), lignes: [],
    }, draft || {});
    // Copie de travail des lignes (on n'écrit dans l'état qu'à l'enregistrement)
    let lignes = c.lignes.map(l => Object.assign({ id: uid(), designation: "", ref: "", produitId: null, refId: null, qty: 1, prix: 0, recu: 0 }, l));
    if (!lignes.length) lignes.push({ id: uid(), designation: "", ref: "", produitId: null, refId: null, qty: 1, prix: 0, recu: 0 });
    const prods = state.produits.slice().sort((a, b) => a.name.localeCompare(b.name, "fr"));

    openModal(existing ? "✎ Commande" : (draft ? "✉ Commande trouvée — vérifiez puis intégrez" : "＋ Nouvelle commande"), `
      <div class="form-grid">
        <div class="field"><label>Fournisseur</label>
          <select id="cm-fourn">
            <option value="">— choisir —</option>
            ${state.fournisseurs.map(f => `<option value="${f.id}" ${c.fournisseurId === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}
            <option value="__autre__" ${!c.fournisseurId && c.fournisseurNom ? "selected" : ""}>Autre…</option>
          </select></div>
        <div class="field" id="cm-fourn-nom-wrap" ${!c.fournisseurId && c.fournisseurNom ? "" : "hidden"}><label>Nom du fournisseur</label>
          <input id="cm-fourn-nom" value="${esc(c.fournisseurNom || "")}"></div>
        <div class="field"><label>N° de commande</label><input id="cm-num" value="${esc(c.numero)}" placeholder="ex : 5000031629"></div>
        <div class="field"><label>Date</label><input id="cm-date" type="date" value="${esc(c.date)}"></div>
        <div class="field"><label>Total TTC (€)</label><input id="cm-total" inputmode="decimal" value="${c.total ? String(c.total).replace(".", ",") : ""}" placeholder="calculé si vide"></div>
        <div class="field"><label>Frais de port (€)</label><input id="cm-port" inputmode="decimal" value="${c.fraisPort ? String(c.fraisPort).replace(".", ",") : ""}"></div>
      </div>
      <div class="section-label" style="margin-top:14px">Articles</div>
      ${draft ? '<div class="field-hint" style="margin:-4px 0 8px">Prix unitaires tels qu\'indiqués dans le mail (HT ou TTC selon le fournisseur). Vérifiez les quantités et le produit du stock associé à chaque ligne.</div>' : ""}
      <div id="cm-lines"></div>
      <button class="btn btn-sm" id="cm-add-line" style="margin-top:8px">＋ Ajouter un article</button>
      <div class="field full" style="margin-top:12px"><label>Note</label><input id="cm-note" value="${esc(c.note || "")}" placeholder="facultatif"></div>
      ${draft && draft.mailSujet ? `<div class="field-hint" style="margin-top:8px">✉ ${esc(draft.mailSujet)}</div>` : ""}`,
      `<button class="btn" data-cancel style="flex:1;justify-content:center">Annuler</button>
       <button class="btn btn-primary" data-ok style="flex:2;justify-content:center">${existing ? "Enregistrer" : "✔ Intégrer la commande"}</button>`);

    const fournSel = document.getElementById("cm-fourn");
    fournSel.onchange = () => { document.getElementById("cm-fourn-nom-wrap").hidden = fournSel.value !== "__autre__"; };
    const linesEl = document.getElementById("cm-lines");

    function prodOptions(sel) {
      return `<option value="">— produit du stock non lié —</option>` + prods.map(p =>
        `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    }
    function renderLines() {
      linesEl.innerHTML = lignes.map((l, i) => `
        <div class="cm-line" data-i="${i}">
          <div class="cm-line-row">
            <input class="cm-desig" placeholder="Désignation" value="${esc(l.designation)}" title="Désignation">
            <button type="button" class="btn btn-sm btn-danger cm-del" title="Retirer">✕</button>
          </div>
          <div class="cm-line-row">
            <input class="cm-ref" placeholder="Réf." value="${esc(l.ref)}" style="flex:1.2">
            <input class="cm-qty" type="number" min="1" inputmode="numeric" value="${l.qty}" title="Quantité" style="flex:.7">
            <input class="cm-prix" inputmode="decimal" placeholder="€ unit." value="${l.prix ? String(l.prix).replace(".", ",") : ""}" title="Prix unitaire" style="flex:.9">
          </div>
          <div class="cm-line-row">
            <select class="cm-prod" title="Produit du stock correspondant">${prodOptions(l.produitId)}</select>
          </div>
          ${l.produitId && !produit(l.produitId) ? "" : ""}
        </div>`).join("");
      linesEl.querySelectorAll(".cm-line").forEach(row => {
        const i = Number(row.dataset.i), l = lignes[i];
        row.querySelector(".cm-desig").oninput = (e) => { l.designation = e.target.value; };
        row.querySelector(".cm-ref").oninput = (e) => { l.ref = e.target.value; };
        row.querySelector(".cm-qty").oninput = (e) => { l.qty = Math.max(1, Math.round(Number(e.target.value) || 1)); };
        row.querySelector(".cm-prix").oninput = (e) => { l.prix = parsePrix(e.target.value); };
        row.querySelector(".cm-prod").onchange = (e) => {
          l.produitId = e.target.value || null;
          l.refId = null;
          const p = l.produitId ? produit(l.produitId) : null;
          if (p) {
            // Référence du produit correspondant à la réf. saisie, sinon celle du fournisseur choisi
            const fid = fournSel.value;
            const r = p.references.find(x => l.ref && normRef(x.ref) === normRef(l.ref))
                   || p.references.find(x => fid && x.fournisseurId === fid) || null;
            if (r) l.refId = r.id;
            if (!l.designation) { l.designation = r && r.designation ? r.designation : p.name; row.querySelector(".cm-desig").value = l.designation; }
          }
        };
        row.querySelector(".cm-del").onclick = () => { lignes.splice(i, 1); renderLines(); };
      });
    }
    renderLines();
    document.getElementById("cm-add-line").onclick = () => { lignes.push({ id: uid(), designation: "", ref: "", produitId: null, refId: null, qty: 1, prix: 0, recu: 0 }); renderLines(); linesEl.lastElementChild.scrollIntoView({ block: "nearest" }); };

    modalRoot.querySelector("[data-cancel]").onclick = closeModal;
    modalRoot.querySelector("[data-ok]").onclick = () => {
      const fv = fournSel.value;
      const data = {
        numero: document.getElementById("cm-num").value.trim(),
        date: document.getElementById("cm-date").value || todayIso(),
        fournisseurId: fv === "__autre__" ? "" : fv,
        fournisseurNom: fv === "__autre__" ? document.getElementById("cm-fourn-nom").value.trim() : "",
        total: parsePrix(document.getElementById("cm-total").value),
        fraisPort: parsePrix(document.getElementById("cm-port").value),
        note: document.getElementById("cm-note").value.trim(),
        lignes: lignes.filter(l => l.designation || l.ref || l.produitId).map(l => {
          if (l.produitId && !produit(l.produitId)) { l.produitId = null; l.refId = null; }
          if (l.produitId && l.refId && !reference(produit(l.produitId), l.refId)) l.refId = null;
          return l;
        }),
      };
      if (!data.fournisseurId && !data.fournisseurNom) { toast("Indiquez le fournisseur."); return; }
      if (!data.lignes.length) { toast("Ajoutez au moins un article."); return; }
      Object.assign(c, data);
      c.statut = statutCommande(c);
      if (!existing) {
        state.commandesSuivi.push(c);
        marquerCommandesCourses(c);
      }
      save(); closeModal();
      switchView("commande", { commandeId: c.id });
      toast(existing ? "Commande enregistrée." : "Commande intégrée au suivi.");
    };
  }
  const MOTS_GENERIQUES = new Set(["taille", "boite", "boites", "carton", "cartons", "sachet", "sachets", "paquet", "lot", "pour", "avec", "sans", "des", "les",
    "une", "conditionnement", "vente", "couleur", "dimension", "unite", "unites", "pcs", "piece", "pieces", "flacon", "tube", "kit", "set", "type", "modele", "option", "ref", "reference"]);
  function normRef(r) { return String(r || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

  /* =========================================================
     ANALYSE D'UN MAIL / TEXTE DE COMMANDE → brouillon
     Heuristiques volontairement prudentes : tout est relu et
     corrigeable dans la fenêtre avant intégration.
     ========================================================= */
  function htmlToText(html) {
    let s = String(html || "");
    s = s.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ");
    s = s.replace(/<!--[\s\S]*?-->/g, " ");
    // Les retours à la ligne du code HTML ne comptent pas : seules les balises structurent le texte
    s = s.replace(/\s+/g, " ");
    s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d|tr|table|thead|tbody)>/gi, "\n").replace(/<tr\b/gi, "\n<tr");
    s = s.replace(/<\/t[dh]>/gi, " | ");
    s = s.replace(/<[^>]+>/g, " ");
    const t = document.createElement("textarea"); t.innerHTML = s; s = t.value;
    return s.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
  }
  function parseDateFr(s, anneeDefaut) {
    let m = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/.exec(s);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return m[0];
    const mois = ["jan", "fev", "mar", "avr", "mai", "juin", "juil", "aou", "sep", "oct", "nov", "dec"];
    m = /(\d{1,2})(?:er)?\s+([a-zéûô]+)\.?(?:\s+(\d{4}))?/i.exec(s);
    if (m) {
      if (!m[3]) { if (!anneeDefaut) return null; m[3] = String(anneeDefaut); }
      const mo = m[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^fevr/, "fev").replace(/^juill/, "juil");
      const i = mois.findIndex(x => mo.startsWith(x) && !(x === "juin" && mo.startsWith("juil")) && !(x === "mar" && mo.startsWith("mai")));
      if (i >= 0) return `${m[3]}-${String(i + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
    return null;
  }
  function devinerFournisseur(text, from) {
    const hay = (text + " " + (from || "")).toLowerCase();
    let best = null;
    state.fournisseurs.forEach(f => {
      const n = f.name.toLowerCase();
      let dom = "";
      try { dom = f.url ? new URL(f.url).hostname.replace(/^www\./, "") : ""; } catch (e) {}
      if ((dom && hay.includes(dom)) || hay.includes(n)) {
        const score = (dom && (from || "").toLowerCase().includes(dom)) ? 3 : hay.includes(n) ? 2 : 1;
        if (!best || score > best.score) best = { f, score };
      }
    });
    return best ? best.f : null;
  }
  // Lie une ligne à un produit du stock : réf. exacte, sinon mots de la désignation
  function lierLigneProduit(l, fournisseurId) {
    const nr = normRef(l.ref);
    if (nr && nr.length >= 3) {
      for (const p of state.produits) for (const r of p.references) {
        if (normRef(r.ref) === nr) { l.produitId = p.id; l.refId = r.id; return; }
      }
    }
    const tokens = (l.designation || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !MOTS_GENERIQUES.has(t));
    if (tokens.length < 2) return;
    let best = null;
    state.produits.forEach(p => {
      const hay = (p.name + " " + p.references.map(r => r.designation || "").join(" ")).toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "");
      const score = tokens.filter(t => hay.includes(t)).length;
      if (score >= 2 && (!best || score > best.score)) best = { p, score };
    });
    if (best && best.score >= Math.max(2, Math.ceil(tokens.length * 0.6))) {
      l.produitId = best.p.id;
      const r = best.p.references.find(x => fournisseurId && x.fournisseurId === fournisseurId) || null;
      l.refId = r ? r.id : null;
    }
  }
  function parseCommandeTexte(text, meta) {
    meta = meta || {};
    const t = String(text || "").replace(/ /g, " ");
    const draft = { source: meta.mailId ? "mail" : "manuel", mailId: meta.mailId || null, mailSujet: meta.sujet || "", lignes: [] };

    /* ---- N° de commande : le jeton doit contenir un chiffre ---- */
    const numRe = /(?:n[°oº]\s*(?:de\s*)?commande|num[ée]ro\s*de\s*(?:la\s*)?commande|r[ée]f[ée]rence\s*(?:de\s*(?:la\s*)?)?commande|order\s*(?:number|n[°o]\.?|#)?|(?:votre\s*)?commande(?:\s*(?:num[ée]ro|n[°oº]\.?))?)[\s|:#\-]*#?\s*(?=[A-Z0-9\-\/_.]*\d)([A-Z0-9][A-Z0-9\-\/_.]{3,})/i;
    let m = numRe.exec(t) || numRe.exec(meta.sujet || "");
    if (m) draft.numero = m[1].replace(/[.,;:]+$/, "");

    /* ---- Date : « passée le … », « du … », « Le 25 sept. 2026 », sinon date du mail ---- */
    const anneeMail = meta.date && !isNaN(new Date(meta.date)) ? new Date(meta.date).getFullYear() : new Date().getFullYear();
    const dm = /(?:date\s*(?:de\s*(?:la\s*)?commande)?|command[ée]e?\s*le|pass[ée]e\s*le|\bdu|^\s*le)[\s|:\-]*(?:(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+)?(\d{1,2}(?:[\/.\-]\d{1,2}[\/.\-]\d{4}|(?:er)?\s+[a-zéû]+\.?(?:\s+\d{4})?))/im.exec(t);
    draft.date = (dm && parseDateFr(dm[1], anneeMail)) || (meta.date ? localIso(new Date(meta.date)) : null) || todayIso();

    /* ---- Montants ---- */
    const MONEY = "(?:€\\s*)?(\\d{1,3}(?:[ .]\\d{3})+(?:[,.]\\d{2})|\\d+[,.]\\d{2})\\s*(?:€|eur\\b)?";
    const toNum = (s) => parsePrix(String(s).replace(/[ .](?=\d{3}\b)/g, "").replace(",", "."));
    const findTotal = (labels) => {
      for (const lab of labels) {
        const re = new RegExp("(?<![a-zé\\-])" + lab + "(?:[^\\d€\\n]{0,40}?|[^\\d€\\n]{0,40}?\\n\\s*\\|?\\s*)" + MONEY, "ig");
        if (new RegExp("(?<![a-zé\\-])" + lab + "[^\\d€\\n]{0,40}?\\b(?:offert|gratuit)", "i").test(t)) return 0;
        let last = null, mm; while ((mm = re.exec(t))) last = mm[1];
        if (last !== null) return toNum(last);
      }
      return 0;
    };
    draft.total = findTotal(["total\\s*(?:à|a)\\s*payer", "montant\\s*total", "total\\s*de\\s*la\\s*commande", "total\\s*ttc", "total\\s*g[ée]n[ée]ral", "(?<!sous[ \\-]?)total(?!\\s*h\\.?t)"]);
    draft.fraisPort = findTotal(["(?<!hors\\s{0,3})frais\\s*de\\s*port(?![^\\n]{0,10}\\])[^\\n]{0,40}?", "participation[^\\n]{0,60}?(?:port|exp[ée]dition|emballage)[^\\n]{0,20}?", "exp[ée]dition", "livraison", "shipping", "\\bport\\b"]);

    /* ---- Fournisseur ---- */
    const f = devinerFournisseur(t, meta.from);
    if (f) draft.fournisseurId = f.id;
    else if (meta.from) {
      const nm = /^"?([^"<@]+?)"?\s*</.exec(meta.from);
      const dom = /@(?:[a-z0-9-]+\.)*?([a-z0-9-]+)\.[a-z]{2,}/i.exec(meta.from);
      draft.fournisseurNom = nm ? nm[1].trim() : (dom ? dom[1].charAt(0).toUpperCase() + dom[1].slice(1) : meta.from.trim());
    }

    /* ---- Articles : lecture bloc par bloc ----
       Une « ligne d'article » = une ligne contenant un prix (ou une quantité
       « × 2 » / « 2 unité(s) »). Les lignes de texte juste avant (nom du
       produit, « Réf : … ») complètent la ligne. Les cellules de tableau
       sont séparées par « | ». */
    const moneyCell = new RegExp("^" + MONEY + "$", "i");
    const moneyAny = new RegExp(MONEY, "ig");
    const qtyCell = /^(\d{1,3})\s*(?:u|x|×|pcs?|pi[èe]ces?|unit[ée]s?|unit[ée]\(s\)|bo[iî]tes?|cartons?)?\s*(?:gratuite\(s\)|gratuits?|offerts?)?\s*(?:\([^)]*\))?$/i;
    const qtySuffix = /\s+×\s*(\d{1,3})(?!\s*(?:ml|cl|mm|cm|m|g|kg|l)\b)(?=\s|$)|\s+x\s*(\d{1,3})\s*$/i;
    const qtyPrefix = /^(\d{1,3})\s*(?:unit[ée]\(s\)|unit[ée]s?|u|pcs?|pi[èe]ces?)\b/i;
    const refCell = /^(?=[A-Z0-9\-\/._]*\d)[A-Z0-9][A-Z0-9\-\/._]{2,}$/i;
    const refLabel = /\[?\s*r[ée]f(?:[ée]rence)?\.?\s*:?\s*(?=[A-Z0-9\-\/._]*\d)([A-Z0-9][A-Z0-9\-\/._]{2,})/i;
    const pctCell = /^\d{1,2}(?:[,.]\d+)?\s*%$/;
    const stop = /(?<![a-z0-9])(sous[\s\-]?total|total|tva|t\.v\.a|taxes?|frais|port|exp[ée]dition|livraison|emballage|participation|remise|r[ée]duction|[ée]conomis[ée]|coupon|code\s*promo|montant|paiement|adresse|t[ée]l(?:[ée]phone)?|iban|siret|rpps|num[ée]ro\s*de\s*client)(?![a-z0-9])/i;
    const header = /\b(produits?|articles?|d[ée]signation|description|r[ée]f[ée]rence|qt[ée]|quantit[ée]|prix|total)\b/ig;
    const lines = t.split("\n").map(s => s.trim());
    let pending = [];

    const cleanCell = (s) => s.replace(/\s{2,}/g, " ").replace(/^[\s\-–:.,|]+|[\s\-–:.,|]+$/g, "").trim();
    const isNoise = (s) => !s || s.length < 3 || /^\d+$/.test(s) || pctCell.test(s) || moneyCell.test(s) || stop.test(s) || /@|https?:\/\//i.test(s);

    function pushItem(desig, ref, qty, prices, rawRef) {
      desig = cleanCell(desig || "");
      if (isNoise(desig)) return;
      qty = Math.max(1, qty || 1);
      let prix = 0;
      if (prices.length) {
        const last = prices[prices.length - 1];
        const unit = prices.find(p => p !== last && Math.abs(p * qty - last) < 0.02);
        prix = unit != null ? unit : Math.round(last / qty * 100) / 100;
      }
      if (!ref) { const im = /\b(?=[A-Z0-9\-]{5,}\b)(?=[A-Z0-9\-]*\d)(?=[A-Z0-9\-]*[A-Z])([A-Z]+\d+[A-Z0-9]*|\d+[A-Z]+[A-Z0-9]*)\b/.exec(desig); if (im) ref = im[1]; }
      const l = { id: uid(), designation: desig.slice(0, 120), ref: cleanCell(ref || rawRef || "").split(/\s/)[0], produitId: null, refId: null, qty, prix, recu: 0 };
      lierLigneProduit(l, draft.fournisseurId);
      draft.lignes.push(l);
    }

    for (let i = 0; i < lines.length; i++) {
      const s = lines[i];
      if (!s || /^[|\s]*$/.test(s)) { pending = []; continue; }
      if (/(?:^|[\s|(])-\s?\d+[,.]\d{2}/.test(s)) { pending = []; continue; } // remise (montant négatif)
      const cells = s.split("|").map(c => c.trim()).filter(Boolean);
      const hdrHits = (s.replace(moneyAny, "").match(header) || []).length;
      if (hdrHits >= 2 && !moneyAny.test(s)) { moneyAny.lastIndex = 0; pending = []; continue; }
      moneyAny.lastIndex = 0;

      const prices = [], others = [];
      let qty = 0, ref = "";
      cells.forEach(c => {
        if (moneyCell.test(c)) prices.push(toNum(c.replace(/[€]|eur\b/ig, "").trim()));
        else if (pctCell.test(c)) return;
        else if (qtyCell.test(c) && !qty) qty = Number(qtyCell.exec(c)[1]);
        else if (refCell.test(c) && !/^\d{1,3}$/.test(c)) ref = c;
        else others.push(c);
      });
      // Prix collés dans une cellule de texte (« … 2 x 5,95 € »)
      if (!prices.length) {
        others.forEach((c, k) => { let mm; const re = new RegExp(MONEY, "ig"); while ((mm = re.exec(c))) prices.push(toNum(mm[1])); if (prices.length) others[k] = c.replace(re, " "); });
      }
      // Quantité en suffixe « × 3 » ou en préfixe « 2 unité(s) »
      others.forEach((c, k) => {
        let mm = qtySuffix.exec(c);
        if (mm && !qty) { qty = Number(mm[1] || mm[2]); others[k] = c.replace(qtySuffix, " "); return; }
        mm = qtyPrefix.exec(c);
        if (mm && !qty && !prices.length) { qty = Number(mm[1]); others[k] = ""; }
      });
      // Référence explicite « Réf : 123-456 » dans la ligne ou juste avant
      const refM = refLabel.exec(s) || pending.map(p => refLabel.exec(p)).find(Boolean);
      if (refM) ref = refM[1];
      others.forEach((c, k) => { others[k] = cleanCell(c.replace(refLabel, " ")); });
      const textCells = others.filter(c => c && !isNoise(c));
      // Ligne de total / TVA / port sans quantité ni référence : on l'ignore
      if (!qty && !ref && stop.test(others.join(" "))) { pending = []; continue; }

      const isItem = prices.length > 0 || (qty > 0 && (textCells.length || pending.length));
      if (!isItem) {
        // Ligne de texte simple : candidate « nom de produit » pour la ligne suivante
        if (/^\|/.test(s)) pending = []; // début d'une nouvelle ligne de tableau
        if (!stop.test(s) && !/@|https?:\/\//i.test(s)) { pending.push(s.replace(/^\|\s*/, "")); if (pending.length > 3) pending.shift(); }
        else pending = [];
        continue;
      }
      // Prix seul sur la ligne suivante (« … × 1 » puis « €314,17 »)
      if (!prices.length && qty > 0 && lines[i + 1] && moneyCell.test(cleanCell(lines[i + 1]))) {
        prices.push(toNum(cleanCell(lines[i + 1]).replace(/[€]|eur\b/ig, "").trim())); i++;
      }
      // Ligne « total / port / tva » : on ignore
      const rowText = textCells.join(" ");
      if (!textCells.length && !pending.length) continue;
      if (textCells.length && !pending.length && stop.test(rowText)) continue;
      const namePending = pending.map(cleanCell).filter(p => p && !isNoise(p) && !refLabel.test(p) && !/^option\s*:/i.test(p));
      let desig;
      if (namePending.length) desig = namePending[namePending.length - 1];
      else desig = textCells.sort((a, b) => b.length - a.length)[0];
      if (desig && qty === 0) { const mm = qtyPrefix.exec(desig); if (mm) { qty = Number(mm[1]); desig = desig.replace(qtyPrefix, ""); } }
      pushItem(desig, ref, qty, prices);
      pending = [];
    }

    // Dédoublonnage (même désignation + même prix) et plafond
    const seen = new Set();
    draft.lignes = draft.lignes.filter(l => { const k = l.designation.toLowerCase() + "|" + l.prix; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 80);
    return draft;
  }
  function ressembleCommande(text, sujet) {
    const hay = (String(sujet || "") + "\n" + String(text || "")).toLowerCase();
    return /\b(commande|order|bon de commande|confirmation|facture|exp[ée]di[ée]e?|livraison)\b/.test(hay)
      && (/(?:€\s*)?\d{1,4}[,.]\d{2}\s*(?:€|eur)/i.test(hay) || /\b\d{1,3}\s*unit[ée]/i.test(hay));
  }

  function openCollerMailModal() {
    openModal("✉ Coller un mail de commande", `
      <p class="lot-sub" style="margin-bottom:8px">Ouvrez le mail de confirmation du fournisseur, sélectionnez tout (Ctrl+A), copiez (Ctrl+C) et collez ici.
      Je repère le n° de commande, la date, le total et les articles — vous vérifiez tout avant d'intégrer.</p>
      <div class="field full"><textarea id="cm-paste" style="min-height:180px" placeholder="Collez le texte du mail ici…"></textarea></div>`,
      `<button class="btn" data-cancel style="flex:1;justify-content:center">Annuler</button>
       <button class="btn btn-primary" data-ok style="flex:2;justify-content:center">Analyser →</button>`);
    modalRoot.querySelector("[data-cancel]").onclick = closeModal;
    modalRoot.querySelector("[data-ok]").onclick = () => {
      const txt = document.getElementById("cm-paste").value;
      if (!txt.trim()) { toast("Collez d'abord le texte du mail."); return; }
      const draft = parseCommandeTexte(txt, {});
      closeModal();
      openCommandeModal(null, draft);
      if (!draft.lignes.length) toast("Aucun article reconnu automatiquement : ajoutez-les à la main.");
    };
  }

  /* =========================================================
     PASSERELLE GMAIL (lecture seule, depuis le navigateur)
     Nécessite un « ID client OAuth » Google (⚙️ Réglages).
     ========================================================= */
  const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
  const GMAIL_CLIENT_ID_DEFAUT = "398491776725-2thppp5q7medqis72hsahop1745q6sci.apps.googleusercontent.com";
  const GMAIL_QUERY_DEFAUT = 'newer_than:60d -in:spam -in:trash (commande OR "bon de commande" OR confirmation OR facture OR order OR expédiée OR expédition)';
  let gmailToken = null; // { token, exp }

  function gmailLoadGis() {
    return new Promise((res, rej) => {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client"; s.async = true;
      s.onload = () => res(); s.onerror = () => rej(new Error("gis"));
      document.head.appendChild(s);
    });
  }
  function gmailGetToken(interactive) {
    if (gmailToken && gmailToken.exp > Date.now() + 30000) return Promise.resolve(gmailToken.token);
    return gmailLoadGis().then(() => new Promise((res, rej) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: state.gmail.clientId,
        scope: GMAIL_SCOPE,
        hint: state.gmail.compte || undefined,
        callback: (resp) => {
          if (resp && resp.access_token) {
            gmailToken = { token: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
            res(gmailToken.token);
          } else rej(new Error((resp && resp.error) || "token"));
        },
        error_callback: (e) => rej(new Error((e && e.type) || "popup")),
      });
      client.requestAccessToken({ prompt: "" });
    }));
  }
  async function gmailApi(path, token) {
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw new Error("gmail " + r.status);
    return r.json();
  }
  function b64urlDecode(s) {
    try {
      const bin = atob(String(s || "").replace(/-/g, "+").replace(/_/g, "/"));
      const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder("utf-8").decode(bytes);
    } catch (e) { return ""; }
  }
  function gmailBody(payload) {
    let plain = "", html = "";
    (function walk(p) {
      if (!p) return;
      const mt = p.mimeType || "";
      if (p.body && p.body.data) {
        if (mt === "text/plain" && !plain) plain = b64urlDecode(p.body.data);
        else if (mt === "text/html" && !html) html = b64urlDecode(p.body.data);
      }
      (p.parts || []).forEach(walk);
    })(payload);
    // Le HTML garde la structure des tableaux (cellules « | ») : plus fiable pour les lignes
    return html ? htmlToText(html) : plain;
  }
  function gmailHeader(payload, name) {
    const h = ((payload && payload.headers) || []).find(x => x.name.toLowerCase() === name.toLowerCase());
    return h ? h.value : "";
  }

  async function gmailVerifier(opts) {
    opts = opts || {};
    if (!state.gmail || !state.gmail.clientId) { openGmailAideModal(); return; }
    toast("✉ Connexion à Gmail…");
    let token;
    try { token = await gmailGetToken(true); }
    catch (e) { toast("Connexion Gmail impossible (" + e.message + "). Vérifiez l'ID client dans ⚙️ Réglages."); return; }
    try {
      const q = state.gmail.query || GMAIL_QUERY_DEFAUT;
      const list = await gmailApi("messages?maxResults=25&q=" + encodeURIComponent(q), token);
      const ids = (list.messages || []).map(m => m.id);
      const connus = new Set(state.commandesSuivi.map(c => c.mailId).filter(Boolean).concat(state.mailsIgnores));
      const nouveaux = ids.filter(id => !connus.has(id));
      state.gmail.dernierCheck = new Date().toISOString();
      try { localStorage.setItem("cybelestock-gmail-check", todayIso()); } catch (e) {}
      const drafts = [];
      for (const id of nouveaux) {
        const msg = await gmailApi("messages/" + id + "?format=full", token);
        const sujet = gmailHeader(msg.payload, "Subject"), from = gmailHeader(msg.payload, "From"), date = gmailHeader(msg.payload, "Date");
        const text = gmailBody(msg.payload);
        if (!ressembleCommande(text, sujet)) { state.mailsIgnores.push(id); continue; }
        const d = parseCommandeTexte(text, { mailId: id, sujet, from, date });
        d.mailFrom = from;
        drafts.push(d);
      }
      // Garde la liste des mails ignorés à une taille raisonnable
      if (state.mailsIgnores.length > 400) state.mailsIgnores = state.mailsIgnores.slice(-300);
      save();
      if (!drafts.length) { toast(opts.manuel ? "Aucune nouvelle commande trouvée dans les mails." : "✉ Mails vérifiés : rien de nouveau."); render(); return; }
      proposerMails(drafts);
    } catch (e) {
      toast("Lecture Gmail impossible (" + e.message + "). L'API Gmail est-elle activée ?");
    }
  }

  // Présente les commandes trouvées une par une
  function proposerMails(drafts) {
    const d = drafts.shift();
    if (!d) { render(); return; }
    const f = d.fournisseurId ? fournisseur(d.fournisseurId) : null;
    openModal("✉ J'ai trouvé cette commande", `
      <div class="scan-result-prod">
        <div class="p-name">${esc(f ? f.name : (d.fournisseurNom || "Expéditeur inconnu"))}${d.numero ? " — n° " + esc(d.numero) : ""}</div>
        <div class="p-sub">${fmtDate(d.date)}${d.total ? " · " + fmtEur(d.total) : ""} · ${d.lignes.length} article${d.lignes.length > 1 ? "s" : ""} reconnu${d.lignes.length > 1 ? "s" : ""}</div>
      </div>
      <div class="lot-sub" style="margin-bottom:8px">✉ ${esc(d.mailSujet || "")}<br>${esc(d.mailFrom || "")}</div>
      ${d.lignes.length ? `<div class="as-list" style="max-height:160px">${d.lignes.slice(0, 12).map(l => `<div class="as-item" style="font-weight:500">${l.qty} × ${esc(l.designation)}${l.prix ? " — " + fmtEur(l.prix) : ""}${l.produitId ? ' <span class="as-cat">→ ' + esc((produit(l.produitId) || {}).name || "") + "</span>" : ""}</div>`).join("")}</div>` : ""}
      <p class="lot-sub" style="margin-top:10px">Dois-je l'intégrer au suivi des commandes ? Vous pourrez corriger chaque ligne avant de valider.${drafts.length ? ` (${drafts.length} autre${drafts.length > 1 ? "s" : ""} ensuite)` : ""}</p>`,
      `<button class="btn" data-ignore style="justify-content:center">Non, ignorer</button>
       <button class="btn" data-later style="justify-content:center">Plus tard</button>
       <button class="btn btn-primary" data-ok style="flex:1;justify-content:center">Oui, intégrer →</button>`);
    modalRoot.querySelector("[data-ignore]").onclick = () => { if (d.mailId) state.mailsIgnores.push(d.mailId); save(); closeModal(); proposerMails(drafts); };
    modalRoot.querySelector("[data-later]").onclick = () => { closeModal(); proposerMails(drafts); };
    modalRoot.querySelector("[data-ok]").onclick = () => { closeModal(); openCommandeModal(null, d); };
  }

  // Vérification quotidienne : proposée à l'ouverture (la connexion Gmail
  // exige un clic de l'utilisateur, on ne peut pas la lancer toute seule).
  function gmailVerifQuotidienne() {
    if (!state.gmail || !state.gmail.clientId || state.gmail.auto === false) return;
    let last = null; try { last = localStorage.getItem("cybelestock-gmail-check"); } catch (e) {}
    if (last === todayIso()) return;
    openModal("✉ Vérification des commandes", `
      <p style="margin-bottom:8px">Voulez-vous que je regarde dans la boîte mail${state.gmail.compte ? " <strong>" + esc(state.gmail.compte) + "</strong>" : ""} s'il y a de nouvelles commandes à intégrer ?</p>
      <p class="lot-sub">Je vous proposerai chaque commande trouvée ; rien n'est intégré sans votre accord.</p>`,
      `<button class="btn" data-later style="flex:1;justify-content:center">Pas aujourd'hui</button>
       <button class="btn btn-primary" data-ok style="flex:2;justify-content:center">Vérifier maintenant</button>`);
    modalRoot.querySelector("[data-later]").onclick = () => { try { localStorage.setItem("cybelestock-gmail-check", todayIso()); } catch (e) {} closeModal(); };
    modalRoot.querySelector("[data-ok]").onclick = () => { closeModal(); gmailVerifier({}); };
  }

  function openGmailAideModal() {
    openModal("✉ Passerelle Gmail — mise en place", `
      <p class="lot-sub" style="margin-bottom:8px">Pour que CybèleStock puisse lire les mails de commande (en lecture seule), Google demande un « ID client OAuth ». À faire une seule fois, environ 10 minutes :</p>
      <ol style="margin:0 0 10px 18px;font-size:.9rem;line-height:1.7;color:var(--muted)">
        <li>Ouvrir <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=cybele-gestion" target="_blank" rel="noopener">Google Cloud → API Gmail</a> (projet <strong>cybele-gestion</strong>, celui de l'application) et cliquer <strong>Activer</strong>.</li>
        <li>Menu <strong>API et services → Écran de consentement OAuth</strong> : type <em>Externe</em>, nom « CybèleStock », vos emails de contact, enregistrer. Dans « Utilisateurs test », ajouter <strong>cybeledent@gmail.com</strong>.</li>
        <li>Menu <strong>Identifiants → Créer des identifiants → ID client OAuth</strong> : type <em>Application Web</em>. Dans « Origines JavaScript autorisées », ajouter l'adresse du site (ex. <code>${esc(location.origin)}</code>).</li>
        <li>Copier l'ID client (se termine par <code>.apps.googleusercontent.com</code>) dans ⚙️ Réglages → Passerelle Gmail.</li>
      </ol>
      <p class="lot-sub">Ensuite, chaque jour à l'ouverture, CybèleStock proposera de vérifier la boîte mail. La 1<sup>re</sup> fois, Google demandera d'autoriser l'accès en lecture au compte cybeledent@gmail.com.</p>`,
      `<button class="btn" data-cancel style="flex:1;justify-content:center">Fermer</button>
       <button class="btn btn-primary" data-ok style="flex:1;justify-content:center">⚙️ Réglages</button>`);
    modalRoot.querySelector("[data-cancel]").onclick = closeModal;
    modalRoot.querySelector("[data-ok]").onclick = () => { closeModal(); switchView("reglages"); };
  }

  /* =========================================================
     DÉPENSES & VALEUR DU STOCK
     ========================================================= */
  // Chiffres financiers partagés (tableau de bord + onglet Dépenses & valeur)
  function financeStats() {
    const parMois = {}, parAn = {};
    state.commandesSuivi.forEach(c => {
      const m = montantCommande(c); if (!m) return;
      const mois = c.date.slice(0, 7), an = c.date.slice(0, 4);
      parMois[mois] = (parMois[mois] || 0) + m;
      parAn[an] = (parAn[an] || 0) + m;
    });
    const hist = lignesPrix();
    let valeur = 0, nbVal = 0, nbSans = 0; const parCat = {}; const sansPrix = [];
    state.produits.forEach(p => {
      const t = stockTotal(p); if (!t) return;
      let vp = 0, ok = true;
      p.lots.forEach(l => { const pu = prixUnitaire(p, l, hist); if (pu) vp += pu.prix * l.qty; else ok = false; });
      if (ok) nbVal++; else { nbSans++; sansPrix.push(p); }
      valeur += vp;
      const cn = (categorie(p.categorieId) || {}).name || "Sans catégorie";
      parCat[cn] = (parCat[cn] || 0) + vp;
    });
    return { parMois, parAn, hist, valeur, nbVal, nbSans, parCat, sansPrix };
  }
  function moisLabel(k, court) {
    return new Date(k + "-01T00:00:00").toLocaleDateString("fr-FR", court ? { month: "short" } : { month: "long", year: "numeric" });
  }
  // Les 6 derniers mois (clé AAAA-MM), du plus ancien au plus récent
  function derniersMois(n) {
    const out = []; const d = new Date(); d.setDate(1);
    for (let i = n - 1; i >= 0; i--) { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(localIso(x).slice(0, 7)); }
    return out;
  }

  function renderFinances() {
    const { parMois, parAn, hist, valeur, nbVal, nbSans, parCat, sansPrix } = financeStats();
    const moisKeys = Object.keys(parMois).sort().reverse().slice(0, 18);
    const anKeys = Object.keys(parAn).sort().reverse();
    const maxMois = Math.max(1, ...moisKeys.map(k => parMois[k]));
    const maxAn = Math.max(1, ...anKeys.map(k => parAn[k]));
    const barre = (label, val, max, sub) => `
      <div class="bar-row"><div class="bar-label">${label}${sub ? `<div class="lot-sub">${sub}</div>` : ""}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Math.round(val / max * 100))}%"></div></div>
        <div class="bar-val">${fmtEur(val)}</div></div>`;
    const catKeys = Object.keys(parCat).sort((a, b) => parCat[b] - parCat[a]);
    const maxCat = Math.max(1, ...catKeys.map(k => parCat[k]));

    // Fourchette de prix par produit
    const parProd = {};
    hist.forEach(h => {
      const e = parProd[h.produitId] || (parProd[h.produitId] = { min: h.prix, max: h.prix, last: h.prix, lastDate: h.date, n: 0, minDate: h.date, maxDate: h.date });
      e.n++;
      if (h.prix < e.min) { e.min = h.prix; e.minDate = h.date; }
      if (h.prix > e.max) { e.max = h.prix; e.maxDate = h.date; }
    });
    const prodKeys = Object.keys(parProd).filter(id => produit(id)).sort((a, b) => produit(a).name.localeCompare(produit(b).name, "fr"));

    return `
      <div class="stat-tiles">
        <div class="stat-tile main"><div class="stat-label">Valeur du stock au cabinet</div><div class="stat-val">${fmtEur(valeur)}</div>
          <div class="lot-sub">${nbVal} produit${nbVal > 1 ? "s" : ""} valorisé${nbVal > 1 ? "s" : ""}${nbSans ? ` · <span style="color:var(--warn)">${nbSans} sans prix connu</span>` : ""}</div></div>
        <div class="stat-tile"><div class="stat-label">Dépenses ${new Date().getFullYear()}</div><div class="stat-val">${fmtEur(parAn[String(new Date().getFullYear())] || 0)}</div></div>
        <div class="stat-tile"><div class="stat-label">Ce mois-ci</div><div class="stat-val">${fmtEur(parMois[todayIso().slice(0, 7)] || 0)}</div></div>
      </div>
      <p class="lot-sub" style="margin:-4px 0 14px">Valeur = quantités en stock × dernier prix d'achat connu (issu des commandes, sinon prix indicatif de la référence). Les dépenses comptent toutes les commandes intégrées (en cours et archivées), à leur date de commande.</p>

      <div class="card"><h4>📅 Dépenses par mois</h4>
        ${moisKeys.length ? moisKeys.map(k => barre(moisLabel(k), parMois[k], maxMois)).join("") : '<div class="lot-sub">Aucune commande avec montant pour le moment.</div>'}</div>
      <div class="card"><h4>📆 Dépenses par année</h4>
        ${anKeys.length ? anKeys.map(k => barre(k, parAn[k], maxAn)).join("") : '<div class="lot-sub">—</div>'}</div>
      <div class="card"><h4>📦 Valeur du stock par catégorie</h4>
        ${catKeys.length ? catKeys.filter(k => parCat[k] > 0).map(k => barre(esc(k), parCat[k], maxCat)).join("") : '<div class="lot-sub">Stock vide ou sans prix.</div>'}
        ${sansPrix.length ? `<div class="lot-sub" style="margin-top:10px">Sans prix connu : ${sansPrix.slice(0, 12).map(p => `<span data-goto="${p.id}" style="cursor:pointer;text-decoration:underline">${esc(p.name)}</span>`).join(", ")}${sansPrix.length > 12 ? "…" : ""} — renseignez un prix indicatif dans la référence, ou intégrez une commande.</div>` : ""}</div>
      <div class="card"><h4>↗ Fourchette de prix d'achat</h4>
        <p class="lot-sub" style="margin-bottom:8px">Prix unitaire le plus bas / le plus haut / dernier payé, d'après les commandes intégrées.</p>
        ${prodKeys.length ? `<div class="price-table">
          <div class="price-head"><span>Produit</span><span>Bas</span><span>Haut</span><span>Dernier</span></div>
          ${prodKeys.map(id => { const e = parProd[id], p = produit(id); const hausse = e.last > e.min * 1.1;
            return `<div class="price-row"><span data-goto="${id}" style="cursor:pointer">${esc(p.name)}<div class="lot-sub">${e.n} achat${e.n > 1 ? "s" : ""}</div></span>
              <span class="price-min">${fmtEur(e.min)}<div class="lot-sub">${fmtDate(e.minDate)}</div></span>
              <span class="price-max">${fmtEur(e.max)}<div class="lot-sub">${fmtDate(e.maxDate)}</div></span>
              <span class="${hausse ? "price-up" : ""}">${fmtEur(e.last)}<div class="lot-sub">${fmtDate(e.lastDate)}</div></span></div>`; }).join("")}
        </div>` : '<div class="lot-sub">Dès qu\'une commande avec des prix est intégrée, l\'historique apparaît ici.</div>'}</div>`;
  }
  function bindFinances() {
    app.querySelectorAll("[data-goto]").forEach(el => el.onclick = () => switchView("fiche", { produitId: el.dataset.goto, ficheTab: "refs" }));
  }

  /* =========================================================
     POINTS DE RESTAURATION (copies de sécurité dans le cloud)
     - « cybelestock-avant-commandes » : état figé avant la v2
     - « cybelestock-snap-<jour> » : état du matin, 7 jours glissants
     ========================================================= */
  const SNAP_JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  function snapshotQuotidien(etat) {
    if (!window.CybeleDB) return;
    let last = null; try { last = localStorage.getItem("cybelestock-snap-date"); } catch (e) {}
    if (last === todayIso()) return;
    const key = "cybelestock-snap-" + SNAP_JOURS[new Date().getDay()];
    window.CybeleDB.save(key, etat).then(() => { try { localStorage.setItem("cybelestock-snap-date", todayIso()); } catch (e) {} }).catch(() => {});
  }
  function openRestaurationModal() {
    if (!window.CybeleDB || !window.CybeleDB.loadFull) { toast("Points de restauration disponibles uniquement en ligne."); return; }
    openModal("↺ Points de restauration", `<div class="lot-sub">Chargement…</div>`,
      `<button class="btn" data-cancel style="flex:1;justify-content:center">Fermer</button>`);
    modalRoot.querySelector("[data-cancel]").onclick = closeModal;
    const keys = ["cybelestock-avant-commandes", "cybelestock-avant-restauration"].concat(SNAP_JOURS.map(j => "cybelestock-snap-" + j));
    Promise.all(keys.map(k => window.CybeleDB.loadFull(k).then(r => ({ k, r })).catch(() => ({ k, r: null })))).then(rows => {
      const body = modalRoot.querySelector(".modal-body"); if (!body) return;
      const dispo = rows.filter(x => x.r && x.r.state).sort((a, b) => (b.r.ts || 0) - (a.r.ts || 0));
      body.innerHTML = `
        <p class="lot-sub" style="margin-bottom:8px">Copies automatiques de vos données (état du matin, 7 jours glissants, plus l'état d'avant la mise en place du suivi des commandes).
        Restaurer remplace les données actuelles — une copie « avant restauration » est faite juste avant.</p>
        ${dispo.length ? dispo.map(x => {
          const s = x.r.state, nP = (s.produits || []).length, nL = (s.produits || []).reduce((t, p) => t + (p.lots || []).reduce((u, l) => u + (Number(l.qty) || 0), 0), 0);
          const label = x.k === "cybelestock-avant-commandes" ? "Avant le suivi des commandes" : x.k === "cybelestock-avant-restauration" ? "Avant la dernière restauration" : "Copie du " + x.k.replace("cybelestock-snap-", "");
          return `<div class="settings-row"><div class="grow"><div style="font-weight:600">${label}</div>
            <div class="settings-sub">${x.r.ts ? new Date(x.r.ts).toLocaleString("fr-FR") : "date inconnue"} · ${nP} produits · ${nL} unités en stock · ${(s.commandesSuivi || []).length} commandes</div></div>
            <button class="btn btn-sm" data-restore="${x.k}">Restaurer</button></div>`;
        }).join("") : '<div class="lot-sub">Aucune copie disponible pour l\'instant (elles se créent automatiquement à chaque première ouverture de la journée).</div>'}`;
      body.querySelectorAll("[data-restore]").forEach(b => b.onclick = async () => {
        const row = rows.find(x => x.k === b.dataset.restore); if (!row || !row.r) return;
        if (!confirm("Remplacer les données actuelles par cette copie ?\nUne copie de l'état actuel sera conservée (« Avant la dernière restauration »).")) return;
        try { await window.CybeleDB.save("cybelestock-avant-restauration", state); } catch (e) { if (!confirm("La copie de sécurité n'a pas pu être faite. Continuer quand même ?")) return; }
        state = normalize(row.r.state);
        save(); closeModal(); render(); toast("Données restaurées.");
      });
    });
  }

  /* =========================================================
     VUE : RÉGLAGES
     ========================================================= */
  function renderReglages() {
    app.innerHTML = `
      <h2 class="view-title">${ico("settings", 24)} Réglages</h2>
      <p class="view-sub">Fournisseurs, catégories et sauvegardes.</p>

      <div class="card">
        <h4>Fournisseurs</h4>
        ${state.fournisseurs.map(f => `
          <div class="settings-row">
            <div class="grow">
              <div style="font-weight:600">${esc(f.name)}</div>
              ${f.url ? `<div class="settings-sub">${esc(f.url)}</div>` : ""}
              ${f.note ? `<div class="settings-sub">${esc(f.note)}</div>` : ""}
            </div>
            ${f.url ? `<a class="link-btn" href="${esc(f.url)}" target="_blank" rel="noopener">🔗</a>` : ""}
            <button class="btn btn-sm" data-edit-f="${f.id}">✎</button>
          </div>`).join("") || '<div class="settings-sub" style="padding:6px 0">Aucun fournisseur.</div>'}
        <div class="toolbar"><button class="btn btn-primary btn-sm" id="btn-add-f">＋ Fournisseur</button></div>
      </div>

      <div class="card">
        <h4>Catégories</h4>
        ${state.categories.map(c => {
          const n = state.produits.filter(p => p.categorieId === c.id).length;
          return `
          <div class="settings-row">
            <div class="grow"><div style="font-weight:600">${esc(c.name)}</div>
              <div class="settings-sub">${n} produit${n > 1 ? "s" : ""}</div></div>
            <button class="btn btn-sm" data-edit-c="${c.id}">✎</button>
            <button class="btn btn-sm btn-danger" data-del-c="${c.id}" ${n ? "disabled title='Contient des produits'" : ""}>🗑</button>
          </div>`;
        }).join("")}
        <div class="toolbar"><button class="btn btn-primary btn-sm" id="btn-add-c">＋ Catégorie</button></div>
      </div>

      <div class="card">
        <h4>✉ Passerelle Gmail (commandes)</h4>
        <p class="settings-sub" style="margin-bottom:10px">
          CybèleStock peut lire (en lecture seule) la boîte mail du cabinet pour repérer les confirmations de commande
          et vous proposer de les intégrer. <button class="auth-link" id="rg-gmail-aide" style="display:inline;margin:0">Comment l'activer ?</button></p>
        <div class="form-grid">
          <div class="field full"><label>ID client OAuth Google</label>
            <input id="rg-gmail-client" value="${esc((state.gmail || {}).clientId || "")}" placeholder="xxxxxxxx.apps.googleusercontent.com"></div>
          <div class="field"><label>Compte Gmail</label>
            <input id="rg-gmail-compte" value="${esc((state.gmail || {}).compte || "cybeledent@gmail.com")}"></div>
          <div class="field"><label>Proposer la vérification</label>
            <select id="rg-gmail-auto"><option value="oui" ${(state.gmail || {}).auto === false ? "" : "selected"}>Chaque jour à l'ouverture</option><option value="non" ${(state.gmail || {}).auto === false ? "selected" : ""}>Seulement à la demande</option></select></div>
          <div class="field full"><label>Recherche Gmail (avancé)</label>
            <input id="rg-gmail-query" value="${esc((state.gmail || {}).query || "")}" placeholder="${esc(GMAIL_QUERY_DEFAUT)}">
            <div class="field-hint">Vide = recherche par défaut (mails des 60 derniers jours contenant « commande », « confirmation », « facture »…).</div></div>
        </div>
        <div class="toolbar">
          <button class="btn btn-primary btn-sm" id="rg-gmail-save">Enregistrer</button>
          <button class="btn btn-sm" id="rg-gmail-test" ${(state.gmail || {}).clientId ? "" : "disabled"}>✉ Vérifier maintenant</button>
          ${(state.gmail || {}).dernierCheck ? `<span class="settings-sub">Dernière vérification : ${new Date(state.gmail.dernierCheck).toLocaleString("fr-FR")}</span>` : ""}
        </div>
      </div>

      <div class="card">
        <h4>Sauvegarde</h4>
        <p class="settings-sub" style="margin-bottom:10px">
          Les données sont synchronisées en ligne (mêmes identifiants sur téléphone et ordinateur).
          Pensez quand même à télécharger une sauvegarde de temps en temps.</p>
        <div class="toolbar">
          <button class="btn btn-sm" id="rg-export">⬇ Télécharger une sauvegarde</button>
          <button class="btn btn-sm" id="rg-import">⬆ Restaurer une sauvegarde</button>
          <button class="btn btn-sm" id="rg-restore-points">↺ Points de restauration</button>
        </div>
        <p class="settings-sub" style="margin-top:8px">Une copie automatique de vos données est faite en ligne à la première ouverture de chaque journée (7 jours glissants).</p>
      </div>`;

    document.getElementById("btn-add-f").onclick = () => openFournisseurModal(null);
    app.querySelectorAll("[data-edit-f]").forEach(b => b.onclick = () => openFournisseurModal(b.dataset.editF));
    document.getElementById("btn-add-c").onclick = () => openCategorieModal(null);
    app.querySelectorAll("[data-edit-c]").forEach(b => b.onclick = () => openCategorieModal(b.dataset.editC));
    app.querySelectorAll("[data-del-c]").forEach(b => b.onclick = () => {
      if (b.disabled) return;
      if (!confirm("Supprimer cette catégorie ?")) return;
      state.categories = state.categories.filter(c => c.id !== b.dataset.delC);
      save(); render();
    });
    document.getElementById("rg-export").onclick = doExport;
    document.getElementById("rg-import").onclick = () => document.getElementById("import-file").click();
    document.getElementById("rg-restore-points").onclick = openRestaurationModal;
    document.getElementById("rg-gmail-aide").onclick = openGmailAideModal;
    document.getElementById("rg-gmail-save").onclick = () => {
      state.gmail = Object.assign({}, state.gmail, {
        clientId: document.getElementById("rg-gmail-client").value.trim(),
        compte: document.getElementById("rg-gmail-compte").value.trim(),
        auto: document.getElementById("rg-gmail-auto").value === "oui",
        query: document.getElementById("rg-gmail-query").value.trim(),
      });
      gmailToken = null;
      save(); render(); toast("Réglages Gmail enregistrés.");
    };
    document.getElementById("rg-gmail-test").onclick = () => gmailVerifier({ manuel: true });
  }

  /* =========================================================
     SAUVEGARDE / RESTAURATION FICHIER
     ========================================================= */
  function doExport() {
    const data = { app: BACKUP_TAG, version: 1, date: new Date().toISOString(), state };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cybelestock-sauvegarde-" + todayIso() + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Sauvegarde téléchargée.");
  }

  document.getElementById("btn-export").onclick = doExport;
  document.getElementById("btn-import").onclick = () => document.getElementById("import-file").click();
  document.getElementById("import-file").onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        let payload = null;
        if (data && data.app === BACKUP_TAG && data.state) payload = data.state;
        else if (data && Array.isArray(data.produits)) payload = data;
        else throw new Error("format");
        if (!confirm("Remplacer les données actuelles par cette sauvegarde ?")) return;
        state = normalize(payload);
        save(); render();
        toast("Sauvegarde restaurée.");
      } catch (err) { toast("Fichier de sauvegarde invalide."); }
    };
    r.readAsText(f);
    e.target.value = "";
  };

  /* =========================================================
     AIDE
     ========================================================= */
  document.getElementById("btn-help").onclick = () => {
    openModal("Aide — CybèleStock", `
      <ul style="margin:0 0 12px 18px; color:var(--muted); line-height:1.8; font-size:.92rem">
        <li><strong>Accueil</strong> : le tableau de bord — produits sous le seuil, commandes à réceptionner, péremptions,
          valeur du stock et dépenses. Chaque chiffre est cliquable.</li>
        <li><strong>📦 Stock</strong> : vos produits rangés par catégories. Boutons ＋/− pour les entrées/sorties rapides.
          Le stock idéal et le seuil mini se règlent dans la fiche de chaque produit.</li>
        <li><strong>📷 Scanner</strong> : au téléphone, scannez le Datamatrix des boîtes. Le 1er scan associe le code
          au produit ; ensuite tout est automatique (péremption et lot remplis). Mode Entrée pour ranger une livraison,
          mode Sortie quand une boîte part au fauteuil.</li>
        <li><strong>🛒 Courses</strong> : dès qu'un stock passe sous son seuil, le produit apparaît ici avec
          les liens vers vos fournisseurs. « ✔ Commandé » le met en attente de réception.</li>
        <li><strong>⏰ Péremption</strong> : lots périmés ou bientôt périmés (alerte activable produit par produit).</li>
        <li><strong>🚚 Commandes</strong> : intégrez vos commandes (à la main, en collant le mail du fournisseur, ou via la
          passerelle Gmail). À la livraison, « 📷 Scanner la réception » : chaque scan valide une ligne et entre les boîtes en stock.
          Commande complète → on vous propose de l'archiver ; incomplète → elle passe en orange avec ses reliquats en haut.
          L'onglet « Dépenses & valeur » montre les dépenses par mois/année, la fourchette de prix par produit et la valeur du stock.</li>
        <li><strong>⚙️ Réglages</strong> : fournisseurs (liens, notes franco de port), catégories, sauvegardes.</li>
      </ul>
      <p style="background:var(--accent-light);padding:12px;border-radius:10px;font-size:.88rem">
        ☁️ Vos données sont <strong>synchronisées</strong> : connectez-vous avec les mêmes identifiants
        sur le téléphone et l'ordinateur pour retrouver le même stock partout.</p>`,
      `<button class="btn btn-primary" data-ok style="flex:1;justify-content:center">Compris</button>`);
    modalRoot.querySelector("[data-ok]").onclick = closeModal;
  };

  /* =========================================================
     NAVIGATION
     ========================================================= */
  document.querySelectorAll(".nav-tab").forEach(t => t.onclick = () => switchView(t.dataset.nav));
  document.getElementById("brand-home").onclick = (e) => { e.preventDefault(); switchView("accueil"); };
  const regMob = document.getElementById("btn-reglages-mobile");
  if (regMob) regMob.onclick = () => switchView("reglages");

  /* =========================================================
     TOASTS
     ========================================================= */
  let toastTimer;
  function toast(msg) {
    clearTimeout(toastTimer);
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    toastTimer = setTimeout(() => el.remove(), 2600);
  }
  function toastUndo(msg, undoFn) {
    clearTimeout(toastTimer);
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.innerHTML = esc(msg) + ' <button style="margin-left:10px;border:none;background:none;color:#8be8cf;font-weight:700;cursor:pointer;text-decoration:underline">Annuler</button>';
    el.querySelector("button").onclick = () => { el.remove(); undoFn(); };
    toastTimer = setTimeout(() => el.remove(), 5000);
  }

  /* =========================================================
     PORTE D'ENTRÉE — AUTHENTIFICATION
     ========================================================= */
  (function setupAuthGate() {
    if (!window.CybeleAuth) return;

    const gate = document.createElement("div");
    gate.className = "auth-gate";
    gate.innerHTML =
      '<div class="auth-card">' +
        '<div class="auth-logo">📦 Cybèle<strong>Stock</strong></div>' +
        '<p class="auth-sub">Gestion du stock — accès réservé au cabinet.</p>' +
        '<div class="auth-field"><label>Identifiant</label>' +
          '<input type="email" id="auth-email" autocomplete="username" placeholder="prénom@cybele-dent.fr"></div>' +
        '<div class="auth-field"><label>Mot de passe</label>' +
          '<input type="password" id="auth-pwd" autocomplete="current-password" placeholder="••••••••"></div>' +
        '<button class="btn btn-primary auth-btn" id="auth-signin">Se connecter →</button>' +
        '<p class="auth-err" id="auth-err" hidden></p>' +
        '<button class="auth-link" id="auth-forgot">Mot de passe oublié ?</button>' +
      '</div>';
    document.body.appendChild(gate);

    const emailEl = gate.querySelector("#auth-email");
    const pwdEl = gate.querySelector("#auth-pwd");
    const errEl = gate.querySelector("#auth-err");
    const btn = gate.querySelector("#auth-signin");
    const showErr = (m, ok) => { errEl.textContent = m; errEl.hidden = false; errEl.style.color = ok ? "var(--ok)" : ""; };

    const doSignIn = () => {
      const email = emailEl.value.trim(), pwd = pwdEl.value;
      if (!email || !pwd) { showErr("Renseignez votre identifiant et votre mot de passe."); return; }
      errEl.hidden = true; btn.disabled = true; btn.textContent = "Connexion…";
      window.CybeleAuth.signIn(email, pwd).catch((e) => {
        showErr(window.CybeleAuth.frError(e));
        btn.disabled = false; btn.textContent = "Se connecter →";
        pwdEl.value = ""; pwdEl.focus();
      });
    };
    btn.onclick = doSignIn;
    pwdEl.addEventListener("keydown", (e) => { if (e.key === "Enter") doSignIn(); });
    emailEl.addEventListener("keydown", (e) => { if (e.key === "Enter") pwdEl.focus(); });

    gate.querySelector("#auth-forgot").onclick = () => {
      const email = emailEl.value.trim();
      if (!email) { showErr("Saisissez d'abord votre identifiant, puis cliquez sur « Mot de passe oublié »."); return; }
      window.CybeleAuth.sendReset(email)
        .then(() => showErr("Si un compte existe, un email de réinitialisation a été envoyé.", true))
        .catch((e) => showErr(window.CybeleAuth.frError(e)));
    };

    const logoutBtn = document.getElementById("btn-logout");
    if (logoutBtn) logoutBtn.onclick = () => {
      if (confirm("Se déconnecter de CybèleStock ?")) window.CybeleAuth.signOut().then(() => location.reload());
    };

    window.CybeleAuth.onChange((user) => {
      if (user) {
        gate.classList.add("hidden");
        if (logoutBtn) { logoutBtn.hidden = false; logoutBtn.title = "Déconnexion (" + (user.email || "") + ")"; }
      } else {
        gate.classList.remove("hidden");
        btn.disabled = false; btn.textContent = "Se connecter →";
        if (logoutBtn) logoutBtn.hidden = true;
        setTimeout(() => { try { emailEl.focus(); } catch (e) {} }, 60);
      }
    });
  })();

  /* =========================================================
     LANCEMENT
     ========================================================= */
  async function init() {
    app.innerHTML = '<div style="text-align:center;padding:80px 20px;color:var(--muted);font-size:1.1rem">⏳ Chargement…</div>';
    if (window.CybeleAuth) { try { await window.CybeleAuth.whenReady(); } catch (e) {} }
    const local = loadLocal();
    if (window.CybeleDB) {
      try {
        const cloud = await Promise.race([
          window.CybeleDB.load(CLOUD_KEY),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 6000)),
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
    // Sécurité : copie figée de l'état AVANT la mise en place du suivi des
    // commandes (une seule fois), puis copie quotidienne de l'état du matin.
    if (window.CybeleDB && state && typeof state === "object") {
      if (!state.snapshotAvantCommandes) {
        const avant = JSON.parse(JSON.stringify(state));
        window.CybeleDB.save("cybelestock-avant-commandes", avant)
          .then(() => { state.snapshotAvantCommandes = Date.now(); save(); })
          .catch(() => {});
      }
      snapshotQuotidien(state);
    }
    state = normalize(state);
    // Migration : si l'état chargé est encore l'ancien état d'essai
    // (vide, ou un seul produit « exemple »), on installe le vrai
    // catalogue des commandes et on le réenregistre (local + cloud).
    if (state.produits.length <= 1 && state.produits.every(p => String(p.name || "").toLowerCase().includes("exemple"))) {
      state = normalize(seed());
      save();
    }
    render();
    setTimeout(gmailVerifQuotidienne, 800);
  }
  // Outils de test (aperçu local uniquement)
  if (/^(localhost|127\.)/.test(location.hostname)) window.CybeleStockDebug = { parseCommandeTexte, htmlToText, getState: () => state, setState: (s) => { state = normalize(s); save(); render(); } };
  init();
})();
