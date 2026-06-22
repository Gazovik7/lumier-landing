/* ===================================================================
   Lumiér — интерактив лендинга
   =================================================================== */
(function () {
  "use strict";
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  // помечаем, что JS активен — анимации появления применяются ТОЛЬКО при включённом JS,
  // иначе (или при сбое) контент остаётся видимым, а не скрытым на opacity:0
  document.documentElement.classList.add("js");

  /* ---------- плейсхолдер до появления картинок ----------
     пока файла в assets/ нет, прячем «битую» иконку и оставляем
     изумрудный градиент-фон, заданный в CSS на самом <img>. */
  function placehold(img) {
    // убираем src и alt-подпись — остаётся CSS-градиент на самом <img>
    img.removeAttribute("src");
    img.setAttribute("aria-hidden", "true");
    img.alt = "";
    img.setAttribute("data-placeholder", "");
  }
  $$("img").forEach((img) => {
    // картинка уже успела не загрузиться до старта скрипта (eager + 404)
    if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) {
      placehold(img);
    } else {
      img.addEventListener("error", () => placehold(img), { once: true });
    }
  });

  /* ---------- снег за курсором на первом экране ---------- */
  (function heroSnow() {
    const canvas = document.getElementById("heroSnow");
    const hero = document.querySelector(".hero");
    if (!canvas || !hero) return;
    if (window.matchMedia("(prefers-reduced-motion:reduce)").matches) return;

    const ctx = canvas.getContext("2d");
    let w = 0,
      h = 0,
      dpr = Math.min(window.devicePixelRatio || 1, 2);
    const flakes = [];
    const MAX = 220;

    function resize() {
      w = hero.clientWidth;
      h = hero.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    function spawn(x, y, n) {
      for (let i = 0; i < n; i++) {
        if (flakes.length >= MAX) flakes.shift();
        const a = Math.random() * Math.PI * 2;
        const sp = Math.random() * 1.1;
        flakes.push({
          x: x + Math.cos(a) * 14,
          y: y + Math.sin(a) * 14,
          r: 1 + Math.random() * 2.6,
          vx: Math.cos(a) * sp,
          vy: 0.4 + Math.random() * 1.3,
          life: 1,
          decay: 0.004 + Math.random() * 0.006,
          warm: Math.random() < 0.35,
        });
      }
    }

    // эмиссия у курсора
    let lastX = 0,
      lastY = 0,
      moved = false;
    hero.addEventListener(
      "pointermove",
      (e) => {
        const rect = hero.getBoundingClientRect();
        lastX = e.clientX - rect.left;
        lastY = e.clientY - rect.top;
        const speed = Math.min(
          12,
          Math.hypot(e.movementX || 0, e.movementY || 0)
        );
        spawn(lastX, lastY, 2 + Math.round(speed / 3));
        moved = true;
      },
      { passive: true }
    );
    hero.addEventListener("pointerleave", () => (moved = false));

    function loop() {
      ctx.clearRect(0, 0, w, h);
      for (let i = flakes.length - 1; i >= 0; i--) {
        const f = flakes[i];
        f.vy += 0.012; // лёгкое ускорение падения
        f.vx *= 0.99;
        f.x += f.vx + Math.sin((f.y + i) * 0.02) * 0.3; // покачивание
        f.y += f.vy;
        f.life -= f.decay;
        if (f.life <= 0 || f.y > h + 8) {
          flakes.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life)) * 0.9;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = f.warm ? "#FFE8B0" : "#EAF4EE";
        ctx.shadowBlur = 8;
        ctx.shadowColor = f.warm
          ? "rgba(255,232,176,.8)"
          : "rgba(220,240,230,.7)";
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      requestAnimationFrame(loop);
    }
    loop();
  })();

  /* ---------- sticky header ---------- */
  const header = $(".header");
  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 20);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- мобильное меню ---------- */
  const burger = $("#burger");
  const nav = $("#nav");
  if (burger) {
    burger.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      burger.setAttribute("aria-expanded", open);
    });
    $$("#nav a").forEach((a) =>
      a.addEventListener("click", () => {
        nav.classList.remove("is-open");
        burger.setAttribute("aria-expanded", "false");
      })
    );
  }

  /* ---------- появление при скролле ---------- */
  const toReveal = $$(
    ".pain, .svc, .plan, .step, .case, .usp__card, .member, .review, .qa, .ba, .video, .safety__visual, .b2b__stats li, .post, .light, .cred, .photo__visual"
  );
  toReveal.forEach((el) => el.classList.add("reveal"));
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e, i) => {
          if (e.isIntersecting) {
            setTimeout(() => e.target.classList.add("is-in"), (i % 6) * 60);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    toReveal.forEach((el) => io.observe(el));
    // страховка: если по какой-то причине наблюдатель не сработал —
    // через 3 c после загрузки показываем всё, чтобы контент не остался скрытым
    window.addEventListener("load", () =>
      setTimeout(
        () => toReveal.forEach((el) => el.classList.add("is-in")),
        3000
      )
    );
  } else {
    toReveal.forEach((el) => el.classList.add("is-in"));
  }

  /* ---------- маска телефона ---------- */
  function maskPhone(input) {
    if (!input) return;
    input.addEventListener("input", () => {
      let v = input.value.replace(/\D/g, "");
      if (v.startsWith("8")) v = "7" + v.slice(1);
      if (!v.startsWith("7")) v = "7" + v;
      v = v.slice(0, 11);
      let out = "+7";
      if (v.length > 1) out += " (" + v.slice(1, 4);
      if (v.length >= 4) out += ") " + v.slice(4, 7);
      if (v.length >= 7) out += "-" + v.slice(7, 9);
      if (v.length >= 9) out += "-" + v.slice(9, 11);
      input.value = out;
    });
  }
  ["#quizPhone", "#leadPhone", "#modalPhone"].forEach((s) => maskPhone($(s)));
  const isPhoneValid = (v) => v.replace(/\D/g, "").length === 11;

  // снимаем подсветку ошибки, как только пользователь ставит галочку/правит телефон
  $$(".agree input").forEach((cb) =>
    cb.addEventListener("change", () =>
      cb.closest(".agree").classList.remove("is-error")
    )
  );

  /* ---------- toast ---------- */
  const toast = $("#toast");
  function showToast() {
    if (!toast) return;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add("is-show"));
    setTimeout(() => {
      toast.classList.remove("is-show");
      setTimeout(() => (toast.hidden = true), 400);
    }, 4200);
  }

  /* ---------- модалка ---------- */
  const modal = $("#modal");
  function openModal() {
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => $("#modal input[name=name]").focus(), 50);
  }
  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
  }
  // ВСЕ CTA-кнопки (и «заказать звонок», и «рассчитать») открывают один попап-форму,
  // а не скроллят по странице
  $$(".js-open-callback, .js-open-quiz").forEach((b) =>
    b.addEventListener("click", openModal)
  );
  $$(".js-close-modal").forEach((b) => b.addEventListener("click", closeModal));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!modal.hidden) closeModal();
      if (!lightbox.hidden) closeLightbox();
    }
  });

  /* ---------- общая отправка форм (заглушка) ---------- */
  function handleLead(form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const phone = form.querySelector('input[type="tel"]');
      const agree = form.querySelector('input[name="agree"]');
      if (phone && !isPhoneValid(phone.value)) {
        phone.style.borderColor = "#e0857e";
        phone.focus();
        return;
      }
      if (agree && !agree.checked) {
        agree.closest(".agree").classList.add("is-error");
        return;
      }
      // здесь должна быть реальная отправка (fetch на бэкенд/CRM/Telegram)
      console.log("LEAD:", Object.fromEntries(new FormData(form)));
      form.reset();
      if (!modal.hidden) closeModal();
      showToast();
    });
  }
  ["#modalForm", "#leadForm"].forEach((s) => $(s) && handleLead($(s)));

  /* ====================================================
     КВИЗ-КАЛЬКУЛЯТОР
     ==================================================== */
  const quiz = {
    form: $("#quizForm"),
    steps: $$(".quiz__step"),
    bar: $("#quizBar"),
    submit: $("#quizSubmit"),
    hint: $("#quizStepHint"),
    result: $("#quizResult"),
    sum: $("#quizSum"),
    cur: 0,
  };

  // js-open-quiz теперь открывает попап (см. блок «модалка» выше) — скролл к секции убран
  function showStep(i) {
    quiz.steps.forEach((s, idx) => s.classList.toggle("is-active", idx === i));
    quiz.bar.style.width = ((i + 1) / quiz.steps.length) * 100 + "%";
    quiz.hint.textContent = `Шаг ${i + 1} из ${quiz.steps.length}`;
    const last = i === quiz.steps.length - 1;
    quiz.submit.hidden = !last;
    if (last) calcPrice();
  }

  function stepValid(i) {
    const step = quiz.steps[i];
    const radios = step.querySelectorAll('input[type="radio"]');
    if (radios.length) return Array.from(radios).some((r) => r.checked);
    return true;
  }

  function calcPrice() {
    const data = new FormData(quiz.form);
    // метраж
    const mEl = quiz.form.querySelector('input[name="meters"]:checked');
    let meters = 120;
    if (mEl) meters = +mEl.closest(".opt").dataset.meters || 120;
    // объект -> множитель охвата
    const obj = data.get("object") || "";
    let objK = 1;
    if (obj.includes("деревья")) objK = 1.25;
    if (obj.includes("участок")) objK = 1.6;
    // этажность
    const fEl = quiz.form.querySelector('input[name="floors"]:checked');
    const floorK = fEl ? +fEl.closest(".opt").dataset.k || 1 : 1;
    // цена за метр по объёму
    let perM = 1300;
    if (meters >= 100) perM = 1100;
    if (meters >= 200) perM = 1000;

    const base = meters * objK * perM * floorK;
    const low = Math.round((base * 0.9) / 1000) * 1000;
    const high = Math.round((base * 1.25) / 1000) * 1000;
    quiz.result.hidden = false;
    quiz.sum.textContent =
      low.toLocaleString("ru-RU") + " – " + high.toLocaleString("ru-RU") + " ₽";
  }

  if (quiz.form) {
    // авто-переход после выбора радио (кроме последнего шага)
    quiz.form.addEventListener("change", (e) => {
      if (e.target.type === "radio" && quiz.cur < quiz.steps.length - 1) {
        setTimeout(() => {
          if (stepValid(quiz.cur)) showStep(++quiz.cur);
        }, 260);
      }
    });
    quiz.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const phone = $("#quizPhone");
      const agree = quiz.form.querySelector('input[name="agree"]');
      if (!isPhoneValid(phone.value)) {
        phone.style.borderColor = "#e0857e";
        phone.focus();
        return;
      }
      if (!agree.checked) {
        agree.closest(".agree").classList.add("is-error");
        return;
      }
      console.log("QUIZ LEAD:", Object.fromEntries(new FormData(quiz.form)));
      showToast();
      quiz.form.reset();
      quiz.cur = 0;
      showStep(0);
    });
    showStep(0);
  }

  /* ====================================================
     ДО / ПОСЛЕ слайдер
     ==================================================== */
  const baRange = $("#baRange");
  if (baRange) {
    const before = $("#baBefore");
    const handle = $("#baHandle");
    const sync = () => {
      const v = baRange.value;
      before.style.clipPath = "inset(0 " + (100 - v) + "% 0 0)";
      handle.style.left = v + "%";
    };
    baRange.addEventListener("input", sync);
    sync();
  }

  /* ====================================================
     ОТЗЫВЫ карусель
     ==================================================== */
  const track = $("#reviewsTrack");
  if (track) {
    const slides = $$(".review", track);
    const dotsWrap = $("#reviewsDots");
    let idx = 0;
    const perView = () => (window.innerWidth <= 1024 ? 1 : 2);
    const maxIndex = () => Math.max(0, slides.length - perView());

    // строим точки-пагинацию
    function buildDots() {
      if (!dotsWrap) return;
      dotsWrap.innerHTML = "";
      for (let i = 0; i <= maxIndex(); i++) {
        const b = document.createElement("button");
        b.setAttribute("aria-label", "Отзыв " + (i + 1));
        b.addEventListener("click", () => {
          idx = i;
          update();
        });
        dotsWrap.appendChild(b);
      }
    }
    const update = () => {
      idx = Math.min(idx, maxIndex());
      const slideW = slides[0].getBoundingClientRect().width + 22;
      track.style.transform = `translateX(${-idx * slideW}px)`;
      if (dotsWrap)
        $$("button", dotsWrap).forEach((d, i) =>
          d.classList.toggle("is-active", i === idx)
        );
    };
    $("#revNext").addEventListener("click", () => {
      idx = idx >= maxIndex() ? 0 : idx + 1;
      update();
    });
    $("#revPrev").addEventListener("click", () => {
      idx = idx <= 0 ? maxIndex() : idx - 1;
      update();
    });
    let prevPv = perView();
    window.addEventListener("resize", () => {
      if (perView() !== prevPv) {
        prevPv = perView();
        buildDots();
      }
      update();
    });
    buildDots();
    update();
  }

  /* ====================================================
     ЛАЙТБОКС портфолио
     ==================================================== */
  const lightbox = $("#lightbox");
  const lightboxImg = $("#lightboxImg");
  function closeLightbox() {
    lightbox.hidden = true;
    document.body.style.overflow = "";
  }
  $$(".js-lightbox").forEach((fig) =>
    fig.addEventListener("click", () => {
      const img = fig.querySelector("img");
      lightboxImg.src = img.src;
      lightboxImg.alt = img.alt;
      lightbox.hidden = false;
      document.body.style.overflow = "hidden";
    })
  );
  if (lightbox) {
    $(".lightbox__close").addEventListener("click", closeLightbox);
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) closeLightbox();
    });
  }

  /* ====================================================
     ВИДЕО — встраиваем YouTube по клику
     ==================================================== */
  $$(".js-video").forEach((v) =>
    v.addEventListener("click", (e) => {
      e.preventDefault();
      const id = v.dataset.video;
      const wrap = document.createElement("div");
      wrap.className = "vid";
      wrap.innerHTML =
        `<iframe width="100%" height="100%" style="position:absolute;inset:0;border:0;border-radius:14px" ` +
        `src="https://www.youtube.com/embed/${id}?autoplay=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
      v.replaceWith(wrap);
    })
  );
})();
