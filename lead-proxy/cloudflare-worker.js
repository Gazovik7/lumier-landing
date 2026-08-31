/* ===================================================================
   Прокси для заявок — Cloudflare Worker (ЗАПАСНОЙ вариант)
   -------------------------------------------------------------------
   ДЛЯ РОССИИ НЕ ПОДХОДИТ: адреса *.workers.dev часто заблокированы, часть
   посетителей до прокси не дозвонится, и заявка потеряется молча. Основной
   вариант — yandex-function.js на Yandex Cloud Functions. Этот файл лежит
   на случай зарубежной аудитории.

   Зачем: сайт статический, и токен бота, положенный в js/main.js, виден
   в исходниках страницы любому. Воркер принимает заявку от браузера и
   сам дозванивается до Telegram, держа токен в шифрованном секрете.
   Браузер знает только URL воркера.

   Секреты (задаются через `wrangler secret put`, НЕ в этом файле и НЕ
   в wrangler.toml — иначе они попадут в git):
     BOT_TOKEN — токен бота от @BotFather
     CHAT_ID   — id чата заявок, у групп с минусом (напр. -1003992290842)

   Необязательная привязка:
     RL — KV-namespace для ограничения частоты. Не привязан — лимит
          просто не работает, всё остальное функционирует как обычно.

   Разворачивание — см. README.md рядом.
   =================================================================== */

// Откуда принимаем заявки. Origin подделывается любым не-браузерным
// клиентом, так что это не защита, а отсечение чужих сайтов, которые
// решат слать заявки через наш воркер.
const ALLOWED_ORIGINS = new Set([
  "https://veshaem-girlyandi.ru",
  "https://www.veshaem-girlyandi.ru",
  // тот же домен в кириллице — браузер отдаёт Origin в punycode
  "https://xn----7sbfgfcb0a1agp8a5g6b3c.xn--p1ai",
  "https://www.xn----7sbfgfcb0a1agp8a5g6b3c.xn--p1ai",
  // адрес GitHub Pages до привязки домена
  "https://gazovik7.github.io",
  // локальная разработка
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

// Подписи полей — те же, что в js/main.js. Сообщение собирает воркер, а не
// браузер: иначе текст в чате целиком диктует тот, кто дёргает endpoint.
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

const MAX_BODY_BYTES = 4096;  // заявка — это несколько коротких полей
const MAX_FIELD_CHARS = 300;  // остальное отрезаем, чтобы чат не залили простыней
const RL_WINDOW_SEC = 600;    // окно ограничения частоты
const RL_MAX_HITS = 5;        // заявок с одного адреса за окно

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.has(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
    }
    if (request.method !== "POST") {
      return reply({ ok: false, error: "method_not_allowed" }, 405, origin, allowed);
    }
    if (!allowed) {
      return reply({ ok: false, error: "origin_not_allowed" }, 403, origin, allowed);
    }
    if (!env.BOT_TOKEN || !env.CHAT_ID) {
      console.error("Не заданы секреты BOT_TOKEN / CHAT_ID");
      return reply({ ok: false, error: "not_configured" }, 500, origin, allowed);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return reply({ ok: false, error: "too_large" }, 413, origin, allowed);
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return reply({ ok: false, error: "bad_json" }, 400, origin, allowed);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return reply({ ok: false, error: "bad_json" }, 400, origin, allowed);
    }
    // телефон — единственное обязательное поле, без него заявка бесполезна
    if (!clean(data.phone)) {
      return reply({ ok: false, error: "phone_required" }, 400, origin, allowed);
    }

    if (await rateLimited(env, request)) {
      return reply({ ok: false, error: "rate_limited" }, 429, origin, allowed);
    }

    const tg = await fetch(
      "https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.CHAT_ID,
          text: leadToText(data),
          disable_web_page_preview: true,
        }),
      }
    );

    if (!tg.ok) {
      // текст ошибки Telegram виден только в логах воркера (`wrangler tail`),
      // наружу не отдаём — он может содержать часть настроек
      console.error("Telegram вернул", tg.status, await tg.text());
      return reply({ ok: false, error: "upstream" }, 502, origin, allowed);
    }
    return reply({ ok: true }, 200, origin, allowed);
  },
};

function clean(value) {
  if (value === null || value === undefined) return "";
  // переводы строк убираем: иначе одно поле подделывает вид нескольких
  return String(value).replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_CHARS);
}

function leadToText(data) {
  const lines = [];
  for (const key of Object.keys(FIELD_LABELS)) {
    const value = clean(data[key]);
    if (value) lines.push(FIELD_LABELS[key] + ": " + value);
  }
  // поля, которых нет в словаре, в чат не пускаем — так посторонний не сможет
  // дописать в сообщение произвольные строки
  return "🎄 Новая заявка с сайта\n\n" + lines.join("\n");
}

// Ограничение частоты на KV. KV согласуется между дата-центрами не мгновенно,
// поэтому лимит приблизительный — он против болтливого скрипта, а не против
// распределённой атаки. Сбой KV не должен ронять заявку: тогда пропускаем.
async function rateLimited(env, request) {
  if (!env.RL) return false;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = "rl:" + ip;
  try {
    const hits = Number((await env.RL.get(key)) || 0) + 1;
    if (hits > RL_MAX_HITS) return true;
    await env.RL.put(key, String(hits), { expirationTtl: RL_WINDOW_SEC });
    return false;
  } catch (err) {
    console.error("KV недоступен, лимит пропущен:", err);
    return false;
  }
}

function corsHeaders(origin, allowed) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
  if (allowed) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

function reply(body, status, origin, allowed) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin, allowed),
  });
}
