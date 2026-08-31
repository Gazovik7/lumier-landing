/* ===================================================================
   Lumiér — интерактив лендинга
   =================================================================== */

/* ===================================================================
   НАСТРОЙКА ОТПРАВКИ ЗАЯВОК  ←  заполнить перед публикацией
   -------------------------------------------------------------------
   Сайт статический (GitHub Pages), своего бэкенда нет. Заявка уходит
   параллельно во все каналы, у которых заполнены поля ниже. Пустой
   канал просто пропускается, форма продолжает работать.

   1) EMAIL — список адресов, заявка уходит на каждый независимо.
      Через FormSubmit регистрация не нужна, но КАЖДЫЙ адрес надо один раз
      подтвердить: сервис присылает на него письмо со ссылкой «Activate Form».
      Пока адрес не подтверждён, письма на него не доставляются, при этом
      остальные адреса работают как обычно.

   2) TELEGRAM — рабочий канал, отправка из браузера прямо в Bot API.
      chatId — id чата/группы. У групп ОТРИЦАТЕЛЬНЫЙ, без минуса Telegram
               отвечает 400 Bad Request.
      token  — приезжает из js/lead-secrets.js. Лежит там ОТКРЫТО и осознанно:
               спрятать его на статическом сайте нельзя, а обходные пути не
               сработали. Подробности и порядок перевыпуска — в том файле.

   3) WEBHOOK — свой обработчик, получает JSON вида
      { source, name, phone, ... , page, ts }.
      НЕ ИСПОЛЬЗУЕТСЯ. В lead-proxy/ лежала попытка спрятать токен за
      функцией в Yandex Cloud, но она не смогла дозвониться до api.telegram.org
      (таймаут на исходящем запросе, при этом из браузера тот же вызов уходит
      за полсекунды). Разбор — lead-proxy/README.md.
      Если когда-нибудь заполнить это поле, пункт 2 надо очистить: иначе
      заявка придёт в группу дважды.
   =================================================================== */
var LEAD_CONFIG = {
  email: {
    endpoints: [
      // Боевой ящик клиента. АДРЕС НЕ ПОДТВЕРЖДЁН и подтверждён быть не может:
      // «Activate Form» приходит на сам этот ящик, доступа к нему нет. Запрос
      // отсюда всегда возвращает success:false и ни на что не влияет.
      // Заявки клиенту доставляет скрипт из mail-to-telegram/ — он пересылает
      // письмо со своей стороны, подтверждение получателя там не требуется.
      // Если адрес когда-нибудь подтвердят, очистите FORWARD_TO в Code.gs,
      // иначе клиенту пойдёт по два письма на заявку.
      "https://formsubmit.co/ajax/girlandahous@yandex.ru",
      // рабочая копия — подтверждён, заявки приходят
      "https://formsubmit.co/ajax/gazovik7@gmail.com",
    ],
  },
  // Бот @veshaemgirlyandirubot пишет в группу «New site (заявки) | Вешаем-гирлянды.рф».
  // Токен — в js/lead-secrets.js, там же про его открытость и перевыпуск.
  // Пусто — канал просто пропускается, заявки идут на почту.
  // chatId у групп ОТРИЦАТЕЛЬНЫЙ: без минуса Telegram отвечает 400 Bad Request.
  telegram: { token: window.LEAD_TOKEN || "", chatId: "-1003992290842" },
  // Прокси: держит токен бота у себя и сам пишет в группу заявок
  // «New site (заявки) | Вешаем-гирлянды.рф». Развернуть и вставить сюда
  // выданный URL — инструкция в lead-proxy/README.md.
  webhook:  ""             // напр. "https://functions.yandexcloud.net/d4e..."
};

/* Страница «Спасибо». Открывается в новой вкладке после отправки любой формы —
   по её просмотру в Яндекс.Метрике считается цель «заявка». На самой странице
   стоит тот же счётчик; уберёте его оттуда — цель перестанет срабатывать. */
var THANKS_URL = "thanks.html";

// id счётчика Метрики — тот же, что в <head> index.html и thanks.html
var METRIKA_ID = 112009045;

/* Идентификатор цели-события: ym(112009045, 'reachGoal', 'zayavka').
   Срабатывает при отправке ЛЮБОЙ формы — попапа «Рассчитать», блока
   «Оставить заявку» и квиз-калькулятора (все три идут через openThanks).

   Цель по просмотру thanks.html и это событие дублируют друг друга нарочно:
   если браузер заблокирует новую вкладку, страница не откроется и цель по
   просмотру не сработает, а событие уйдёт всё равно. В Метрике заведите обе
   и смотрите по той, что удобнее. */
var LEAD_GOAL = "zayavka";

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

  /* ====================================================
     ОТПРАВКА ЗАЯВОК — почта + Telegram + вебхук
     Настройки — в LEAD_CONFIG наверху файла.
     ==================================================== */
  const CFG = window.LEAD_CONFIG || {};

  // человекочитаемые подписи полей для письма и сообщения в Telegram
  const FIELD_LABELS = {
    source: "Форма",
    name: "Имя",
    phone: "Телефон",
    object: "Что украшаем",
    meters: "Метраж по контуру",
    floors: "Этажность",
    when: "Сроки монтажа",
    estimate: "Расчёт на сайте",
    page: "Страница",
  };
  const FIELD_ORDER = Object.keys(FIELD_LABELS);

  function collectLead(form, source, extra) {
    const data = { source: source };
    new FormData(form).forEach((v, k) => {
      if (k === "agree" || !String(v).trim()) return;
      data[k] = String(v).trim();
    });
    Object.assign(data, extra || {});
    data.page = location.href;
    data.ts = new Date().toISOString();
    return data;
  }

  function leadToText(data) {
    const seen = new Set(FIELD_ORDER);
    const lines = FIELD_ORDER.filter((k) => data[k]).map(
      (k) => FIELD_LABELS[k] + ": " + data[k]
    );
    Object.keys(data).forEach((k) => {
      if (!seen.has(k) && k !== "ts" && data[k]) lines.push(k + ": " + data[k]);
    });
    return "🎄 Новая заявка с сайта\n\n" + lines.join("\n");
  }

  // Возвращает по запросу на каждый адрес: неподтверждённый ящик не должен
  // мешать остальным — каждый уходит независимо.
  function sendEmail(data) {
    const cfg = CFG.email || {};
    const urls = cfg.endpoints || (cfg.endpoint ? [cfg.endpoint] : []);
    if (!urls.length) return [];
    const body = {
      _subject: "Заявка с сайта: " + (data.phone || data.source),
      _template: "table",   // письмо таблицей, а не сплошным текстом
      _captcha: "false",    // без промежуточной страницы с капчей
    };
    Object.keys(data).forEach((k) => {
      body[FIELD_LABELS[k] || k] = data[k];
    });
    return urls.map((url) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      }).then((r) => {
        // FormSubmit отвечает 200 даже когда письмо не ушло (например, адрес
        // не подтверждён) — реальный итог лежит в теле ответа
        r.clone().json().then(
          (j) => {
            if (String(j.success) !== "true")
              console.error("Письмо не доставлено:", url, "—", j.message);
          },
          () => {}
        );
        return r;
      })
    );
  }

  function sendTelegram(data) {
    const tg = CFG.telegram || {};
    if (!tg.token || !tg.chatId) return null;
    return fetch("https://api.telegram.org/bot" + tg.token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: tg.chatId,
        text: leadToText(data),
        disable_web_page_preview: true,
      }),
    });
  }

  function sendWebhook(data) {
    if (!CFG.webhook) return null;
    return fetch(CFG.webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  // Отправляем во все настроенные каналы разом. Пользователю показываем успех
  // сразу — заявка не должна «зависать» из-за медленного стороннего сервиса,
  // а ошибки пишем в консоль, чтобы их было видно при отладке.
  function sendLead(data) {
    const jobs = [...sendEmail(data), sendTelegram(data), sendWebhook(data)].filter(Boolean);
    if (!jobs.length) {
      console.warn("LEAD (каналы отправки не настроены, см. LEAD_CONFIG в js/main.js):", data);
      return Promise.resolve();
    }
    return Promise.allSettled(jobs).then((res) => {
      res.forEach((r) => {
        if (r.status === "rejected") console.error("Не удалось отправить заявку:", r.reason);
        else if (r.value && !r.value.ok)
          console.error("Канал отправки вернул ошибку:", r.value.status, r.value.url);
      });
    });
  }

  /* ---------- страница «Спасибо» ----------
     Открываем её в новой вкладке: исходная остаётся на месте, и запросы из
     sendLead не обрываются — навигация в текущей вкладке отменила бы
     незавершённые fetch, и заявка могла бы не уйти.

     ВАЖНО: вызывать строго СИНХРОННО из обработчика submit. Если отложить
     вызов (в setTimeout или .then), браузер перестанет считать окно
     следствием действия пользователя и заблокирует его как всплывающее. */
  function openThanks(sending) {
    // ym(112009045, 'reachGoal', 'zayavka') — цель-событие дублирует цель по
    // просмотру thanks.html: если вкладку всё же заблокировали, заявка не
    // пропадёт из отчётов Метрики. Проверка typeof — на случай, если счётчик
    // не загрузился (блокировщик, обрыв сети): форма из-за этого падать не должна.
    try {
      if (typeof window.ym === "function") {
        window.ym(METRIKA_ID, "reachGoal", window.LEAD_GOAL || "zayavka");
      }
    } catch (e) {}

    const url = window.THANKS_URL || "thanks.html";
    let tab = null;
    // третий аргумент («noopener») не передаём: с ним window.open по
    // спецификации возвращает null, и мы бы каждый раз думали, что заблокировано
    try {
      tab = window.open(url, "_blank");
    } catch (e) {}
    if (tab) return;

    // вкладку не дали — уходим на страницу в текущей, но только после того,
    // как отправка завершится, иначе оборвём её на полпути
    Promise.resolve(sending)
      .catch(() => {})
      .then(() => {
        location.href = url;
      });
  }

  /* ---------- общие формы (попап + блок «Оставить заявку») ---------- */
  function handleLead(form, source) {
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
      openThanks(sendLead(collectLead(form, source)));
      form.reset();
      if (!modal.hidden) closeModal();
      showToast();
    });
  }
  const LEAD_FORMS = {
    "#modalForm": "Попап «Рассчитать»",
    "#leadForm": "Блок «Оставить заявку»",
  };
  Object.keys(LEAD_FORMS).forEach((s) => $(s) && handleLead($(s), LEAD_FORMS[s]));

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
      openThanks(
        sendLead(
          collectLead(quiz.form, "Квиз-калькулятор", {
            estimate: quiz.sum ? quiz.sum.textContent : "",
          })
        )
      );
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
  const lbPrev = $("#lightboxPrev");
  const lbNext = $("#lightboxNext");
  const lbCount = $("#lightboxCount");

  // текущая «плёнка»: массив {src, alt} + позиция. Для одиночных фото длина = 1.
  let lbShots = [];
  let lbIdx = 0;

  function renderLightbox() {
    const shot = lbShots[lbIdx];
    if (!shot) return;
    lightboxImg.src = shot.src;
    lightboxImg.alt = shot.alt || "";
    const many = lbShots.length > 1;
    lbPrev.hidden = lbNext.hidden = lbCount.hidden = !many;
    if (many) lbCount.textContent = `${lbIdx + 1} / ${lbShots.length}`;
  }
  function openLightbox(shots, idx) {
    lbShots = shots;
    lbIdx = idx || 0;
    renderLightbox();
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function stepLightbox(dir) {
    lbIdx = (lbIdx + dir + lbShots.length) % lbShots.length;
    renderLightbox();
  }
  function closeLightbox() {
    lightbox.hidden = true;
    document.body.style.overflow = "";
  }

  // одиночные фото (лента соцсетей, пара «днём / вечером»).
  // data-full — полноразмерный кадр: в сетке лежит версия под мелкий слот,
  // её нельзя растягивать на весь экран
  $$(".js-lightbox").forEach((fig) =>
    fig.addEventListener("click", (e) => {
      e.preventDefault();
      const img = fig.querySelector("img");
      openLightbox([{ src: fig.dataset.full || img.currentSrc || img.src, alt: img.alt }], 0);
    })
  );

  /* ---------- галереи проектов в кейсах ---------- */
  $$(".js-gal").forEach((gal) => {
    const main = $(".js-gal-main", gal);
    const thumbs = $$(".cthumb", gal);
    if (!main || !thumbs.length) return;
    // в лайтбокс отдаём полноразмерный кадр (data-full), в карточку — версию
    // под её слот (data-src + data-mainset)
    const shots = thumbs.map((t) => ({
      src: t.dataset.full || t.dataset.src,
      alt: t.dataset.alt || "",
    }));
    let cur = 0;

    const select = (i) => {
      cur = i;
      const t = thumbs[i];
      // srcset надо менять вместе с src, иначе браузер продолжит показывать
      // прежнюю картинку из старого набора
      main.srcset = t.dataset.mainset || "";
      main.src = t.dataset.src;
      main.alt = shots[i].alt;
      thumbs.forEach((el, n) => el.classList.toggle("is-active", n === i));
    };
    thumbs.forEach((t, i) =>
      t.addEventListener("click", (e) => {
        e.preventDefault();
        select(i);
      })
    );
    // клик по большому фото или по лупе — полноэкранный просмотр с текущего кадра
    main.addEventListener("click", () => openLightbox(shots, cur));
    const zoom = $(".js-gal-zoom", gal);
    if (zoom) zoom.addEventListener("click", () => openLightbox(shots, cur));
  });

  if (lightbox) {
    $(".lightbox__close").addEventListener("click", closeLightbox);
    lbPrev.addEventListener("click", () => stepLightbox(-1));
    lbNext.addEventListener("click", () => stepLightbox(1));
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener("keydown", (e) => {
      if (lightbox.hidden || lbShots.length < 2) return;
      if (e.key === "ArrowLeft") stepLightbox(-1);
      if (e.key === "ArrowRight") stepLightbox(1);
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
