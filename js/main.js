/* CYBÈLE DENT — interactions */
document.addEventListener("DOMContentLoaded", function () {

  /* =========================================================
     ENCART D'OUVERTURE (PROVISOIRE)
     Pour le retirer une fois le cabinet ouvert :
     passez la ligne ci-dessous à  false
     ========================================================= */
  var ANNONCE_ACTIVE = true;

  if (ANNONCE_ACTIVE && !sessionStorage.getItem("annonceFermee")) {
    var ov = document.createElement("div");
    ov.className = "annonce-modal";
    ov.innerHTML =
      '<div class="annonce-backdrop"></div>' +
      '<div class="annonce-box" role="dialog" aria-modal="true" aria-label="Ouverture du cabinet">' +
        '<button class="annonce-close" type="button" aria-label="Fermer">&times;</button>' +
        '<img class="annonce-logo" src="assets/logo.svg" alt="Cybèle Dent">' +
        '<span class="annonce-badge">Ouverture prochaine</span>' +
        '<h2>Le cabinet ouvre bientôt&nbsp;!</h2>' +
        '<p>Le cabinet dentaire des <strong>Dr Céline Filipputti</strong> et <strong>Dr Laura Agosto</strong> ouvrira ses portes <strong>début septembre</strong>.</p>' +
        '<p>La <strong>prise de rendez-vous en ligne</strong> sera disponible <strong>courant juillet</strong>.</p>' +
        '<button class="btn btn-primary annonce-ok" type="button">Découvrir le cabinet</button>' +
      '</div>';
    document.body.appendChild(ov);
    document.body.classList.add("modal-open");

    var fermerAnnonce = function () {
      ov.remove();
      document.body.classList.remove("modal-open");
      sessionStorage.setItem("annonceFermee", "1");
      document.removeEventListener("keydown", onEsc);
    };
    var onEsc = function (e) { if (e.key === "Escape") fermerAnnonce(); };

    ov.querySelector(".annonce-close").addEventListener("click", fermerAnnonce);
    ov.querySelector(".annonce-ok").addEventListener("click", fermerAnnonce);
    ov.querySelector(".annonce-backdrop").addEventListener("click", fermerAnnonce);
    document.addEventListener("keydown", onEsc);
  }

  /* ---- Menu mobile ---- */
  const toggle = document.querySelector(".nav-toggle");
  const links  = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      links.classList.toggle("open");
      toggle.classList.toggle("open");
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        links.classList.remove("open");
        toggle.classList.remove("open");
      });
    });
  }

  /* ---- Ombre de l'en-tête au scroll ---- */
  const header = document.querySelector(".site-header");
  if (header) {
    const onScroll = function () {
      header.classList.toggle("scrolled", window.scrollY > 10);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---- Accordéon des actes ---- */
  document.querySelectorAll(".act-head").forEach(function (head) {
    head.addEventListener("click", function () {
      const act  = head.closest(".act");
      const body = act.querySelector(".act-body");
      const open = act.classList.contains("open");

      // referme les autres
      document.querySelectorAll(".act.open").forEach(function (o) {
        o.classList.remove("open");
        o.querySelector(".act-body").style.maxHeight = null;
      });

      if (!open) {
        act.classList.add("open");
        body.style.maxHeight = body.scrollHeight + "px";
      }
    });
  });

  /* ---- Apparition au scroll ---- */
  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && reveals.length) {
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    reveals.forEach(function (el, i) {
      el.style.transitionDelay = (i % 4) * 80 + "ms";
      io.observe(el);
    });
  } else {
    reveals.forEach(function (el) { el.classList.add("visible"); });
  }

  /* ---- Frise « parcours de soins » ---- */
  var parcours = document.querySelector(".parcours-track");
  if (parcours && "IntersectionObserver" in window) {
    var po = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var prog = parcours.querySelector(".parcours-progress");
          if (prog) prog.classList.add("run");
          parcours.querySelectorAll(".pstep").forEach(function (st, i) {
            setTimeout(function () { st.classList.add("visible"); }, i * 220);
          });
          po.disconnect();
        }
      });
    }, { threshold: 0.25 });
    po.observe(parcours);
  } else if (parcours) {
    parcours.querySelectorAll(".pstep").forEach(function (st) { st.classList.add("visible"); });
  }

  /* ---- Fiches détaillées des soins (fenêtre modale) ---- */
  var modal = document.getElementById("soinModal");
  if (modal) {
    var content = modal.querySelector(".soin-modal-content");
    var lastFocused = null;
    function openSoin(card) {
      var detail = card.querySelector(".soin-detail");
      content.innerHTML = detail ? detail.innerHTML : "";
      lastFocused = card;
      modal.hidden = false;
      document.body.classList.add("modal-open");
      var c = modal.querySelector(".soin-modal-close");
      if (c) c.focus();
    }
    function closeSoin() {
      modal.hidden = true;
      document.body.classList.remove("modal-open");
      if (lastFocused) lastFocused.focus();
    }
    document.querySelectorAll(".soin-card").forEach(function (card) {
      card.addEventListener("click", function () { openSoin(card); });
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSoin(card); }
      });
    });
    modal.querySelector(".soin-modal-close").addEventListener("click", closeSoin);
    modal.querySelector(".soin-modal-backdrop").addEventListener("click", closeSoin);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeSoin();
    });
  }

  /* ---- Année dans le pied de page ---- */
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
});
