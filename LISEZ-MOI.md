# Site internet — Cybèle Dent

Site vitrine du cabinet dentaire **Cybèle Dent**, 8 rue Calixte II, 38200 Vienne (Isère).

## 📂 Contenu

| Fichier | Rôle |
|---------|------|
| `index.html` | Page d'accueil (fond cathédrale + logo animé) |
| `equipe.html` | Présentation de l'équipe (cartes cliquables vers les pages praticiennes) |
| `dr-celine-filipputti-dentiste-vienne.html` | Page du Dr Céline Filipputti |
| `dr-laura-agosto-dentiste-vienne.html` | Page du Dr Laura Agosto |
| `clotilde-peaut-pedodontie-vienne.html` | Page de Clotilde Péaut (soins des enfants) |
| `salles.html` | Les salles du cabinet |
| `actes.html` | Les soins réalisés (page « Nos soins » : une carte par soin, qui mène à sa page détaillée) |
| `prevention-dentaire-vienne.html` | Page détaillée : prévention dentaire |
| `soins-dentaires-carie-vienne.html` | Page détaillée : soins dentaires et caries |
| `parodontologie-vienne.html` | Page détaillée : parodontologie (gencives) |
| `endodontie-vienne.html` | Page détaillée : endodontie (dévitalisation) |
| `prothese-dentaire-vienne.html` | Page détaillée : prothèses dentaires |
| `implant-dentaire-vienne.html` | Page détaillée : implants dentaires |
| `pedodontie-dentiste-enfant-vienne.html` | Page détaillée : pédodontie (dentiste pour enfants) |
| `eclaircissement-dentaire-vienne.html` | Page détaillée : éclaircissement dentaire |
| `urgence-dentaire-vienne.html` | Page détaillée : urgence dentaire (douleur, abcès, dent cassée) |
| `gouttiere-bruxisme-apnee-sommeil-vienne.html` | Page détaillée : gouttière de bruxisme et orthèse d'apnée du sommeil |
| `tarifs-remboursement-dentiste-vienne.html` | Tarifs et remboursements (conventionnement, carte Vitale, tiers payant, 100 % Santé, devis) |
| `en/index.html` | Page de présentation en anglais (visiteurs étrangers), liée à l'accueil |
| `contact.html` | Coordonnées, horaires et plan |
| `css/style.css` | Mise en forme |
| `js/main.js` | Menu, animations |
| `assets/` | Logo et illustration de la cathédrale |

## ▶️ Voir le site

Double-cliquez simplement sur **`index.html`** : il s'ouvre dans votre navigateur.

## ✏️ À personnaliser (important)

Déjà renseignés : ✅ téléphone `04 22 97 97 65`, ✅ e-mail `cybeledent@gmail.com`, ✅ horaires (lun/mar/jeu 8h30–13h / 14h–18h, mer 9h–13h / 14h–19h, ven 8h30–13h / 14h–15h),
✅ noms des praticiennes (Dr Filipputti, Dr Agosto).

Restent **provisoires** à remplacer (« Rechercher / Remplacer » dans tous les `.html`) :

1. **Lien de prise de rendez-vous** — remplacer `https://www.doctolib.fr`
   par votre vrai lien (Doctolib, Maiia, etc.).
2. **Nom de domaine** — pour le référencement, remplacer `https://www.cybele-dent.fr`
   par votre vrai domaine dans : `sitemap.xml`, `robots.txt`, et les balises
   `canonical` / `og:` / données structurées de chaque page `.html`.
3. **Autres membres de l'équipe** (assistantes, secrétariat) — compléter `equipe.html`.
4. **Photos des salles** — voir ci-dessous.

## 🔎 Référencement (SEO) — déjà en place

- **Une page par soin** (implants, pédodontie, parodontologie, endodontie, prothèses,
  prévention, caries, éclaircissement, urgences). Auparavant, le détail des soins s'ouvrait dans une
  fenêtre sur la page « Nos soins » : ce contenu caché n'était pas référencé comme une page
  à part entière. Chaque soin a désormais sa propre adresse, son titre, sa description, un
  texte visible enrichi (déroulement, questions fréquentes) et des données structurées Google,
  ce qui permet de ressortir sur des recherches comme *implant dentaire Vienne* ou
  *dentiste enfant Vienne*.
- Pour **ajouter du contenu** à un soin : ouvrez sa page `.html` et complétez le texte dans la
  partie `<article class="soin-main">` (les titres `<h2>`, les paragraphes `<p>`, la liste
  d'étapes `<ol class="steps">` et les questions `<details class="faq">`). Pensez à mettre à
  jour la date `<lastmod>` de la page dans `sitemap.xml`.
- **Accueil** : bloc « Dentiste à Vienne pour les adultes et les enfants » (prise de rendez-vous
  Doctolib : adultes avec les Dr Filipputti ou Agosto, enfants de 3 à 16 ans avec Clotilde Péaut),
  liste des communes voisines desservies et questions fréquentes balisées pour Google.
- Données structurées sur chaque page : fil d'Ariane, fiche du cabinet avec horaires (contact),
  fiches des praticiennes (équipe), soin + questions fréquentes (pages de soins).
- Photos optimisées : la photo de la cathédrale (fond des pages) a été compressée de 7,6 Mo à
  moins de 1 Mo pour accélérer le chargement, critère de classement Google. Si vous remplacez une
  photo, visez moins de 500 Ko (format JPEG, 1600 à 1800 px de large).
- **Assistants IA (ChatGPT, Perplexity, Claude…)** : `robots.txt` autorise tous les robots sur les
  pages publiques (et exclut les applications internes), et `llms.txt` résume le site en texte
  clair pour les assistants IA. Pensez à mettre `llms.txt` à jour quand les horaires, l'équipe ou
  les soins changent. Inscriptions à faire une fois : Bing Webmaster Tools (import depuis Google
  Search Console), Bing Places et Apple Business Connect.
- Titres et descriptions optimisés pour : *dentiste Vienne, urgence dentaire Vienne,
  carie, cabinet dentaire, implant dentaire Vienne, parodontie Vienne, pédodontie Vienne,
  dentiste enfant Vienne*.
- Données structurées Google (fiche « Dentiste » : adresse, téléphone, horaires).
- `sitemap.xml` + `robots.txt` + balises Open Graph (partage réseaux sociaux).
- **À faire après mise en ligne :** déclarer le site sur
  [Google Search Console](https://search.google.com/search-console), y soumettre
  `sitemap.xml` (pour que Google découvre vite les nouvelles pages) et créer/mettre à
  jour la fiche **Google Business Profile** du cabinet (essentiel pour le local) en y
  ajoutant les soins avec un lien vers chaque page. Le référencement des nouvelles pages
  prend généralement de quelques semaines à quelques mois.

## 🖼️ Ajouter les vraies photos

- ✅ **Photo de la cathédrale** (`assets/cathedrale-vienne.jpg`), ✅ **logo**
  (`assets/logo-cabinet.jpg`) et ✅ **portraits** des praticiennes : déjà intégrés.
- **Photos équipe (assistantes & secrétariat) :** déposez **3 photos** dans
  `assets/` avec exactement ces noms, elles s'afficheront automatiquement :
  `equipe-assistante-1.jpg`, `equipe-assistante-2.jpg`, `equipe-secretaire.jpg`.
  (Pensez à remplacer les `[Prénom Nom]` correspondants dans `equipe.html`.)
- **Photos des salles :** même principe dans `salles.html`.
- ✅ **Photos des soins (page « Nos soins ») :** toutes en place (prévention,
  soins dentaires, parodontologie, endodontie, prothèses, implants, pédodontie,
  éclaircissement).

> Conseil : des photos lumineuses et nettes (format paysage pour les salles,
> format carré pour les portraits) donneront le meilleur rendu.

## 🌐 Mettre le site en ligne

Hébergement gratuit et simple : **Netlify** ou **GitHub Pages**.
Sur Netlify, il suffit de glisser-déposer le dossier complet — le site est en ligne en quelques secondes.
