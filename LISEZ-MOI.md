# Site internet — Cybèle Dent

Site vitrine du cabinet dentaire **Cybèle Dent**, 8 rue Calixte II, 38200 Vienne (Isère).

## 📂 Contenu

| Fichier | Rôle |
|---------|------|
| `index.html` | Page d'accueil (fond cathédrale + logo animé) |
| `equipe.html` | Présentation de l'équipe |
| `salles.html` | Les salles du cabinet |
| `actes.html` | Les soins réalisés (détaillés) |
| `contact.html` | Coordonnées, horaires et plan |
| `css/style.css` | Mise en forme |
| `js/main.js` | Menu, accordéon, animations |
| `assets/` | Logo et illustration de la cathédrale |

## ▶️ Voir le site

Double-cliquez simplement sur **`index.html`** : il s'ouvre dans votre navigateur.

## ✏️ À personnaliser (important)

Déjà renseignés : ✅ téléphone `04 58 28 36 82`, ✅ horaires (lun/mar/jeu/ven 8h30–18h),
✅ noms des praticiennes (Dr Filipputti, Dr Agosto).

Restent **provisoires** à remplacer (« Rechercher / Remplacer » dans tous les `.html`) :

1. **E-mail** — remplacer `contact@cybele-dent.fr` par l'adresse réelle.
2. **Lien de prise de rendez-vous** — remplacer `https://www.doctolib.fr`
   par votre vrai lien (Doctolib, Maiia, etc.).
3. **Nom de domaine** — pour le référencement, remplacer `https://www.cybele-dent.fr`
   par votre vrai domaine dans : `sitemap.xml`, `robots.txt`, et les balises
   `canonical` / `og:` / données structurées de chaque page `.html`.
4. **Autres membres de l'équipe** (assistantes, secrétariat) — compléter `equipe.html`.
5. **Photos des salles** — voir ci-dessous.

## 🔎 Référencement (SEO) — déjà en place

- Titres et descriptions optimisés pour : *dentiste Vienne, urgence dentaire Vienne,
  carie, cabinet dentaire, implant dentaire Vienne, parodontie Vienne*.
- Données structurées Google (fiche « Dentiste » : adresse, téléphone, horaires).
- `sitemap.xml` + `robots.txt` + balises Open Graph (partage réseaux sociaux).
- **À faire après mise en ligne :** déclarer le site sur
  [Google Search Console](https://search.google.com/search-console) et créer/mettre à
  jour la fiche **Google Business Profile** du cabinet (essentiel pour le local).

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
