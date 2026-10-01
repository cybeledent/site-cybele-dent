/* CYBÈLE DENT — interactions */
document.addEventListener("DOMContentLoaded", function () {

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

  /* ---- Année dans le pied de page ---- */
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
});
