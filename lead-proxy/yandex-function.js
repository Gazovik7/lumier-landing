/* ===================================================================
   Прокси для заявок — Yandex Cloud Function (основной вариант)
   -------------------------------------------------------------------
   Зачем: сайт статический, и токен бота, положенный в js/main.js, виден
   в исходниках страницы любому. Функция принимает заявку от браузера и
   сама обращается к Telegram, держа токен в переменной окружения.
   Браузер знает только URL функции.

   Почему Яндекс, а не Cloudflare: адреса *.workers.dev в России часто
   заблокированы, и часть посетителей до прокси не дозвонится.
   functions.yandexcloud.net — российская инфраструктура, таких проблем нет.
   Вариант на Cloudflare оставлен в cloudflare-worker.js.

   Переменные окружения функции:
     BOT_TOKEN — токен бота от @BotFather
     CHAT_ID   — id чата заявок, у групп с минусом (напр. -1003992290842)

   Разворачивание — см. README.md рядом.
   =================================================================== */

// Откуда принимаем заявки. Origin подделывается любым не-браузерным
// клиентом, так что это не защита, а отсечение чужих сайтов, которые
// решат слать заявки через наш прокси.
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

// Подписи полей — те же, что в js/main.js. Сообщение собирает прокси, а не
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
const MAX_FIELD_CHARS = 300;  // остальное отрезаем, чтобы чат не залили простынёй
const RL_WINDOW_MS = 600000;  // окно ограничения частоты — 10 минут
const RL_MAX_HITS = 5;        // заявок с одного адреса за окно

// Счётчик частоты живёт в памяти экземпляра функции. Экземпляров может быть
// несколько, и при простое они выгружаются — поэтому лимит приблизительный.
// Он против болтливого скрипта, а не против распределённой атаки; жёсткий
// лимит потребовал бы внешнего хранилища (YDB), что для лендинга излишне.
const hits = new Map();

module.exports.handler = async function (event) {
  const headers = lowerKeys(event && event.headers);
  const origin = headers.origin || "";
  const allowed = ALLOWED_ORIGINS.has(origin);
  const method = String((event && event.httpMethod) || "").toUpperCase();

  if (method === "OPTIONS") return reply(null, 204, origin, allowed);
  if (method !== "POST") return reply({ ok: false, error: "method_not_allowed" }, 405, origin, allowed);
  if (!allowed) return reply({ ok: false, error: "origin_not_allowed" }, 403, origin, allowed);

  const token = process.env.BOT_TOKEN;
  const chatId = process.env.CHAT_ID;
  if (!token || !chatId) {
    console.error("Не заданы переменные окружения BOT_TOKEN / CHAT_ID");
    return reply({ ok: false, error: "not_configured" }, 500, origin, allowed);
  }

  const raw = readBody(event);
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

  if (rateLimited(headers)) {
    return reply({ ok: false, error: "rate_limited" }, 429, origin, allowed);
  }

  let tg;
  try {
    tg = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: leadToText(data),
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    console.error("Не удалось обратиться к Telegram:", err);
    return reply({ ok: false, error: "upstream" }, 502, origin, allowed);
  }

  if (!tg.ok) {
    // текст ошибки Telegram виден только в логах функции, наружу не отдаём —
    // он может содержать часть настроек
    console.error("Telegram вернул", tg.status, await tg.text());
    return reply({ ok: false, error: "upstream" }, 502, origin, allowed);
  }
  return reply({ ok: true }, 200, origin, allowed);
};

function lowerKeys(obj) {
  const out = {};
  if (!obj) return out;
  for (const key of Object.keys(obj)) out[key.toLowerCase()] = obj[key];
  return out;
}

// Тело приходит либо строкой, либо base64 — зависит от Content-Type запроса.
function readBody(event) {
  const body = (event && event.body) || "";
  if (event && event.isBase64Encoded) {
    return Buffer.from(body, "base64").toString("utf8");
  }
  return String(body);
}

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

function rateLimited(headers) {
  const ip = headers["x-forwarded-for"] || "unknown";
  const now = Date.now();
  const seen = hits.get(ip);
  if (!seen || now - seen.since > RL_WINDOW_MS) {
    hits.set(ip, { since: now, count: 1 });
    cleanupHits(now);
    return false;
  }
  seen.count += 1;
  return seen.count > RL_MAX_HITS;
}

// Map живёт между вызовами, пока экземпляр тёплый — подчищаем, чтобы он
// не разрастался на долгоживущем экземпляре.
function cleanupHits(now) {
  if (hits.size < 1000) return;
  for (const [ip, seen] of hits) {
    if (now - seen.since > RL_WINDOW_MS) hits.delete(ip);
  }
}

function reply(body, status, origin, allowed) {
  const headers = { Vary: "Origin" };
  if (allowed) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  if (body === null) return { statusCode: status, headers, body: "" };
  headers["Content-Type"] = "application/json; charset=utf-8";
  return { statusCode: status, headers, body: JSON.stringify(body) };
}
