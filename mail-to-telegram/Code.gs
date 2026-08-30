/**
 * Заявки из почты в Telegram — вешаем-гирлянды.рф
 * ---------------------------------------------------------------------------
 * ЗАЧЕМ. Раньше заявку в Telegram отправлял браузер посетителя, напрямую в
 * api.telegram.org. У части людей этот адрес недоступен (сломанный IPv6,
 * ограничения оператора), запрос молча падал — человек видел «спасибо»,
 * а сообщение в группу не приходило. Письма при этом доходили всегда.
 *
 * ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ. Раз в минуту смотрит почтовый ящик, находит новые
 * письма FormSubmit с заявками и сам отправляет их в группу. Работает на
 * серверах Google, от сети посетителя не зависит вообще: если письмо пришло —
 * заявка попадёт в Telegram.
 *
 * Потерять заявку скрипт не может и в обратную сторону: если Telegram не
 * ответил, письмо НЕ помечается обработанным и уедет на следующем запуске.
 *
 * ЖИВОЙ СКРИПТ (аккаунт gazovik7@gmail.com, под другим не откроется):
 * https://script.google.com/home/projects/18lHbAjeyfarh1w0WP2YBXAEPVWjNgU5c_uZGRzl9Mu3RnCLKikiSk3e7/edit
 *
 * Этот файл — исходник. Правки здесь в живой скрипт сами не попадают:
 * скопировать целиком, вставить поверх в редакторе, Ctrl+S.
 *
 * УСТАНОВКА И ОБСЛУЖИВАНИЕ — mail-to-telegram/README.md.
 */

/* ── настройки ─────────────────────────────────────────────────────────────
   BOT_TOKEN и CHAT_ID лежат в свойствах скрипта, а не здесь: так они не
   попадают ни в репозиторий, ни в чужие глаза. Задаются один раз, см. README. */

// по какой теме ищем письма — префикс задаётся в js/main.js, поле _subject
var SUBJECT = "Заявка с сайта";

// на сколько дней назад смотреть; при первом запуске так подберутся и те
// заявки, что уже потерялись. Дальше скрипт помнит обработанные письма.
var LOOKBACK_DAYS = 2;

// ярлык на обработанных цепочках — чтобы глазами видеть, что скрипт отработал
var LABEL = "tg-sent";

// сколько id обработанных писем держим в памяти скрипта.
// Не поднимать сильно: Google даёт 9 КБ на одно свойство, а id письма ~19 байт.
// 300 штук с запасом перекрывают LOOKBACK_DAYS — больше и не нужно.
var SEEN_LIMIT = 300;

// подписи полей в том порядке, в каком они идут в js/main.js (FIELD_LABELS).
// По ним же отсеиваются мусорные строки: письмо FormSubmit свёрстано вложенными
// таблицами, и разбор разметки цепляет лишние <tr> от самой вёрстки.
var KNOWN_FIELDS = [
  "Форма",
  "Имя",
  "Телефон",
  "Что украшаем",
  "Метраж по контуру",
  "Этажность",
  "Сроки монтажа",
  "Расчёт на сайте",
  "Страница",
];

/* ── главная функция: её и вешаем на триггер ─────────────────────────────── */
function forwardLeads() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("BOT_TOKEN");
  var chatId = props.getProperty("CHAT_ID");
  if (!token || !chatId) {
    throw new Error("Не заданы свойства скрипта BOT_TOKEN и CHAT_ID — см. README");
  }

  // два запуска одновременно перекрыли бы друг друга и продублировали заявки
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;

  try {
    var seen = readSeen(props);
    var label = getLabel();
    var query = 'subject:"' + SUBJECT + '" newer_than:' + LOOKBACK_DAYS + "d";
    var threads = GmailApp.search(query, 0, 50);
    var pending = [];

    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (m) {
        if (seen.indexOf(m.getId()) === -1) pending.push({ msg: m, thread: thread });
      });
    });

    // видно в «Выполнениях»: нашлось ли что-то вообще и сколько новых
    Logger.log(
      "Запрос: " + query + " → цепочек: " + threads.length + ", новых писем: " + pending.length
    );

    // старые письма первыми — в чате заявки лягут в том порядке, в каком приходили
    pending.sort(function (a, b) {
      return a.msg.getDate().getTime() - b.msg.getDate().getTime();
    });

    for (var i = 0; i < pending.length; i++) {
      var entry = pending[i];
      var res = sendTelegram(token, chatId, buildMessage(entry.msg));

      if (!res.ok) {
        // Telegram не принял. Письмо не помечаем — уедет на следующем запуске.
        // 429 (слишком часто) значит, что и остальные не пройдут: выходим.
        Logger.log("Не отправлено (" + res.code + "): " + res.body);
        if (res.code === 429) break;
        continue;
      }

      seen.push(entry.msg.getId());
      entry.thread.addLabel(label);
      Utilities.sleep(400); // Bot API не любит очередь быстрее ~20 сообщений в минуту
    }

    writeSeen(props, seen);
  } finally {
    lock.releaseLock();
  }
}

/* ── сборка текста сообщения ────────────────────────────────────────────────
   FormSubmit присылает письмо таблицей (_template: "table" в js/main.js):
   строки вида <tr><td>Подпись</td><td>Значение</td></tr>. Разбираем их.
   Если разметка когда-нибудь поменяется — уходит текстовая версия письма,
   заявка не потеряется в любом случае. */
function buildMessage(msg) {
  var rows = parseTable(msg.getBody());
  var body = rows.length ? layout(rows) : "";
  if (!body) body = cleanPlain(msg.getPlainBody());

  var text = "🎄 Новая заявка с сайта\n\n" + body;
  return text.length > 3900 ? text.slice(0, 3900) + "\n…" : text;
}

// Сначала известные поля в привычном порядке, следом всё остальное осмысленное.
// ts не выводим: время видно у самого сообщения в чате.
function layout(rows) {
  var found = {};
  rows.forEach(function (r) {
    if (!(r.label in found)) found[r.label] = r.value;
  });

  var lines = [];
  KNOWN_FIELDS.forEach(function (label) {
    if (found[label]) lines.push(label + ": " + found[label]);
  });

  rows.forEach(function (r) {
    if (KNOWN_FIELDS.indexOf(r.label) !== -1) return;
    if (r.label.toLowerCase() === "ts") return;
    // отсев строк, порождённых вёрсткой письма, а не данными заявки
    if (r.label.length > 40 || r.value.length > 300) return;
    var line = r.label + ": " + r.value;
    if (lines.indexOf(line) === -1) lines.push(line);
  });

  return lines.join("\n");
}

function parseTable(html) {
  var rows = [];
  var trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  var tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  var tr;

  while ((tr = trRe.exec(html)) !== null) {
    var cells = [];
    var td;
    tdRe.lastIndex = 0;
    while ((td = tdRe.exec(tr[1])) !== null) cells.push(stripTags(td[1]));
    if (cells.length >= 2 && cells[0] && cells[1]) {
      rows.push({ label: cells[0], value: cells.slice(1).join(" ") });
    }
  }
  return rows;
}

// мнемоники, которые встречаются в письме: кавычки-ёлочки из названий форм
// («Попап «Рассчитать»»), тире, неразрывный пробел
var ENTITIES = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  laquo: "«",
  raquo: "»",
  ldquo: "“",
  rdquo: "”",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rub: "₽",
};

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s) {
  return s
    // числовые: &#171; и &#xAB;
    .replace(/&#x([0-9a-f]+);/gi, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/&#(\d+);/g, function (_, dec) {
      return String.fromCharCode(parseInt(dec, 10));
    })
    // именованные; неизвестные оставляем как есть, чтобы не портить текст
    .replace(/&([a-z]+);/gi, function (whole, name) {
      var key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : whole;
    });
}

// у текстовой версии письма FormSubmit внизу своя подпись — в чате она не нужна
function cleanPlain(text) {
  var cut = text.split(/Sent (?:from|by) FormSubmit|formsubmit\.co/i)[0];
  return cut.replace(/\n{3,}/g, "\n\n").trim();
}

/* ── Telegram ──────────────────────────────────────────────────────────────*/
function sendTelegram(token, chatId, text) {
  var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({
      chat_id: chatId,
      text: text,
      disable_web_page_preview: true,
    }),
  });
  var code = res.getResponseCode();
  return { ok: code === 200, code: code, body: res.getContentText() };
}

/* ── память об обработанных письмах ────────────────────────────────────────*/
function readSeen(props) {
  try {
    var raw = props.getProperty("SEEN_IDS");
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function writeSeen(props, seen) {
  if (seen.length > SEEN_LIMIT) seen = seen.slice(seen.length - SEEN_LIMIT);
  props.setProperty("SEEN_IDS", JSON.stringify(seen));
}

function getLabel() {
  return GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
}

/* ── разовые команды, запускаются руками из редактора ──────────────────────*/

// Проверка связи: шлёт в группу тестовое сообщение. Ничего не помечает.
function testTelegram() {
  var props = PropertiesService.getScriptProperties();
  var res = sendTelegram(
    props.getProperty("BOT_TOKEN"),
    props.getProperty("CHAT_ID"),
    "✅ Проверка связи: пересылка заявок из почты настроена."
  );
  Logger.log(res.code + " " + res.body);
}

// Включает автозапуск раз в минуту. Повторный вызов не плодит дубли триггеров.
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "forwardLeads") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("forwardLeads").timeBased().everyMinutes(1).create();
  Logger.log("Триггер поставлен: forwardLeads раз в минуту.");
}

// Аварийный сброс памяти: после него скрипт заново разошлёт письма за
// последние LOOKBACK_DAYS дней. Нужен, только если заявки надо продублировать.
function resetSeen() {
  PropertiesService.getScriptProperties().deleteProperty("SEEN_IDS");
  Logger.log("Память обработанных писем очищена.");
}
