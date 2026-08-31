/**
 * Заявки из почты в Telegram — вешаем-гирлянды.рф
 * ---------------------------------------------------------------------------
 * ЗАЧЕМ. Раньше заявку в Telegram отправлял браузер посетителя, напрямую в
 * api.telegram.org. У части людей этот адрес недоступен (сломанный IPv6,
 * ограничения оператора), запрос молча падал — человек видел «спасибо»,
 * а сообщение в группу не приходило. Письма при этом доходили всегда.
 *
 * ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ. Раз в минуту смотрит почтовый ящик, находит новые
 * письма FormSubmit с заявками и рассылает их по двум каналам:
 *
 *   1) в группу заявок Telegram — на серверах Google, от сети посетителя это
 *      не зависит вообще: если письмо пришло, заявка попадёт в чат;
 *   2) письмом на боевой ящик клиента (FORWARD_TO) — он не подтверждён
 *      в FormSubmit и напрямую заявок не получает, подробности у FORWARD_TO.
 *
 * Потерять заявку скрипт не может: канал, который не сработал, не помечает
 * письмо обработанным, и оно уедет на следующем запуске. Каналы помнят
 * отправленное порознь, поэтому сбой одного не плодит дубли в другом.
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

/* Куда дублировать заявку письмом.
   -------------------------------------------------------------------
   Ящики клиента не подтверждены в FormSubmit и напрямую заявок не получают.
   Подтвердить их нечем: и «Activate Form» у FormSubmit, и штатная пересылка
   в настройках Gmail требуют кода, который приходит НА САМ ЭТОТ ЯЩИК,
   а доступа к ящикам нет.

   Отправка письма из Apps Script подтверждения получателя не требует —
   поэтому пересылаем сами, отсюда.

   Адреса через запятую, все уходят в одном письме и видят друг друга в поле
   «Кому». Пусто — пересылка выключена. Значение можно переопределить
   свойством скрипта FORWARD_TO, тогда менять получателей получится без
   правки кода.

   ВНИМАНИЕ НА КВОТУ: у бесплатного аккаунта Google 100 ПОЛУЧАТЕЛЕЙ в сутки,
   а не 100 писем. Четыре адреса — значит около 25 заявок в день. Упрётесь —
   заявка не помечается пересланной и уедет, когда квота обновится; потерять
   её нельзя, но клиент увидит письмо с задержкой. Остаток показывает
   testForward. */
var FORWARD_TO = [
  "girlandahous@yandex.ru",
  "ser.serpantin@ya.ru",
  "ukrashenia-kng@ya.ru",
  "ukrasit-dom@ya.ru",
].join(",");

// имя отправителя, каким письмо видно в ящике получателя
var FORWARD_FROM_NAME = "Заявки с сайта Lumiér";

/* Каналы помнят обработанные письма ОТДЕЛЬНО друг от друга. Иначе сбой одного
   тянул бы за собой повтор другого: не ответил Telegram — и клиенту повторно
   ушло бы то же письмо. */
var SEEN_TG = "SEEN_IDS";
var SEEN_MAIL = "SEEN_MAIL_IDS";

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
    var seenTg = readSeen(props, SEEN_TG);
    var seenMail = readSeen(props, SEEN_MAIL);
    var forwardTo = (props.getProperty("FORWARD_TO") || FORWARD_TO || "").trim();

    var label = getLabel();
    var query = 'subject:"' + SUBJECT + '" newer_than:' + LOOKBACK_DAYS + "d";
    var threads = GmailApp.search(query, 0, 50);
    var pending = [];

    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (m) {
        var id = m.getId();
        var needTg = seenTg.indexOf(id) === -1;
        var needMail = !!forwardTo && seenMail.indexOf(id) === -1;
        if (needTg || needMail) {
          pending.push({ msg: m, thread: thread, needTg: needTg, needMail: needMail });
        }
      });
    });

    // видно в «Выполнениях»: нашлось ли что-то вообще и сколько кому осталось
    Logger.log(
      "Запрос: " + query +
      " → цепочек: " + threads.length +
      ", в Telegram: " + pending.filter(function (p) { return p.needTg; }).length +
      ", на почту: " + pending.filter(function (p) { return p.needMail; }).length
    );

    // старые письма первыми — в чате заявки лягут в том порядке, в каком приходили
    pending.sort(function (a, b) {
      return a.msg.getDate().getTime() - b.msg.getDate().getTime();
    });

    for (var i = 0; i < pending.length; i++) {
      var entry = pending[i];
      var id = entry.msg.getId();

      // ---- дубль письмом на ящик клиента ----
      if (entry.needMail && forwardEmail(entry.msg, forwardTo)) seenMail.push(id);

      // ---- сообщение в группу ----
      if (!entry.needTg) continue;

      var res = sendTelegram(token, chatId, buildMessage(entry.msg));
      // группу могли превратить в супергруппу — дальше шлём уже по новому id
      if (res.chatId) chatId = res.chatId;

      if (!res.ok) {
        // Telegram не принял. Письмо не помечаем — уедет на следующем запуске.
        // 429 (слишком часто) значит, что и остальные не пройдут: выходим.
        Logger.log("Не отправлено (" + res.code + "): " + res.body);
        if (res.code === 429) break;
        continue;
      }

      seenTg.push(id);
      entry.thread.addLabel(label);
      Utilities.sleep(400); // Bot API не любит очередь быстрее ~20 сообщений в минуту
    }

    writeSeen(props, SEEN_TG, seenTg);
    writeSeen(props, SEEN_MAIL, seenMail);
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

/* ── Telegram ──────────────────────────────────────────────────────────────
   Отдельная история — превращение группы в супергруппу. Telegram делает это
   сам (при смене настроек, назначении админа, росте числа участников) и
   выдаёт чату НОВЫЙ id, а старый навсегда перестаёт принимать сообщения:
   в ответ приходит 400 «group chat was upgraded to a supergroup chat» и новый
   id в parameters.migrate_to_chat_id. Один раз это уже случилось и оборвало
   канал молча. Поэтому ловим такой ответ, запоминаем новый id в свойствах
   скрипта и сразу повторяем отправку — вмешательства не требуется.
   Возвращаем действующий chatId, чтобы вызывающий цикл переключился на него
   и не бился в старый на каждом письме. */
function sendTelegram(token, chatId, text) {
  var res = postMessage(token, chatId, text);
  if (res.ok || res.code !== 400) return res;

  var moved = migratedChatId(res.body);
  if (!moved) return res;

  PropertiesService.getScriptProperties().setProperty("CHAT_ID", String(moved));
  Logger.log("Группа стала супергруппой. Новый CHAT_ID сохранён: " + moved);

  res = postMessage(token, moved, text);
  res.chatId = moved;
  return res;
}

function postMessage(token, chatId, text) {
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
  return { ok: code === 200, code: code, body: res.getContentText(), chatId: chatId };
}

// достаёт parameters.migrate_to_chat_id из ответа Telegram, если он там есть
function migratedChatId(body) {
  try {
    var j = JSON.parse(body);
    var moved = j && j.parameters && j.parameters.migrate_to_chat_id;
    return moved ? moved : null;
  } catch (e) {
    return null;
  }
}

/* ── пересылка письмом ─────────────────────────────────────────────────────
   Пересылаем исходное письмо как есть: клиент получает ту же таблицу с полями,
   какую сформировал FormSubmit. Тема сохраняется — иначе Gmail подставил бы
   «Fwd:» и письма хуже искались бы по теме. */
function forwardEmail(msg, to) {
  try {
    msg.forward(to, { subject: msg.getSubject(), name: FORWARD_FROM_NAME });
    return true;
  } catch (e) {
    // обычно это исчерпанная суточная квота Gmail (у бесплатного аккаунта
    // 100 получателей в сутки). Письмо не помечаем — уедет на следующем запуске
    // или завтра, когда квота обновится.
    Logger.log("Не переслано на " + to + ": " + e);
    return false;
  }
}

/* ── память об обработанных письмах ────────────────────────────────────────*/
function readSeen(props, key) {
  try {
    var raw = props.getProperty(key);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function writeSeen(props, key, seen) {
  if (seen.length > SEEN_LIMIT) seen = seen.slice(seen.length - SEEN_LIMIT);
  props.setProperty(key, JSON.stringify(seen));
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
// последние LOOKBACK_DAYS дней — и в группу, и на почту клиента.
// Нужен, только если заявки надо продублировать.
function resetSeen() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(SEEN_TG);
  props.deleteProperty(SEEN_MAIL);
  Logger.log("Память обработанных писем очищена — оба канала.");
}

// Разовая команда на момент включения пересылки.
// Помечает все письма в окне LOOKBACK_DAYS как уже пересланные, НИЧЕГО не
// отправляя. Без неё при первом запуске клиенту разом улетят заявки за двое
// суток, в том числе тестовые. После неё на почту уйдут только новые.
// На Telegram не влияет — там своя память.
function skipMailBacklog() {
  var props = PropertiesService.getScriptProperties();
  var seen = readSeen(props, SEEN_MAIL);
  var threads = GmailApp.search(
    'subject:"' + SUBJECT + '" newer_than:' + LOOKBACK_DAYS + "d", 0, 50
  );

  var n = 0;
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (m) {
      if (seen.indexOf(m.getId()) === -1) {
        seen.push(m.getId());
        n++;
      }
    });
  });

  writeSeen(props, SEEN_MAIL, seen);
  Logger.log(
    "Помечено как уже пересланное, без отправки: " + n +
    " писем. На почту клиента уйдут только новые заявки."
  );
}

// Проверка пересылки: шлёт на адреса из FORWARD_TO последнюю найденную заявку.
// Ничего не помечает, на автоматическую работу не влияет.
function testForward() {
  var props = PropertiesService.getScriptProperties();
  var to = (props.getProperty("FORWARD_TO") || FORWARD_TO || "").trim();
  if (!to) {
    Logger.log("FORWARD_TO пуст — пересылка выключена.");
    return;
  }

  var threads = GmailApp.search('subject:"' + SUBJECT + '" newer_than:30d', 0, 1);
  if (!threads.length) {
    Logger.log("Писем с заявками за 30 дней не нашлось — нечего пересылать.");
    return;
  }

  var msgs = threads[0].getMessages();
  var ok = forwardEmail(msgs[msgs.length - 1], to);

  // квота считается в получателях, а не в письмах: делим на число адресов,
  // чтобы сразу видеть, на сколько ещё заявок хватит
  var recipients = to.split(",").length;
  var left = MailApp.getRemainingDailyQuota();
  Logger.log(
    (ok ? "Переслано на " : "НЕ переслано на ") + to +
    " (" + recipients + " адр.). Остаток квоты: " + left +
    " получателей — это ещё " + Math.floor(left / recipients) + " заявок на сегодня."
  );
}
