"use strict";
/*
  سيرفر حجز كراسي الأتوبيس — بدون أي مكتبات خارجية
  التشغيل:  node server.js   ثم افتح http://localhost:3000
  البيانات بتتخزن في: data/bookings.json
*/
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "bookings.json");
const SEAT_COUNT = 28;
const MAX_BODY = 8 * 1024; // 8KB

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- تخزين JSON (ملف واحد) ---------- */
function readData() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return d && typeof d === "object" ? d : {};
  } catch {
    return {};
  }
}

function writeData(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE); // كتابة ذرّية عشان مفيش تلف
}

// قفل بسيط عشان حجزين في نفس اللحظة ما يحصلوش تعارض
let lock = Promise.resolve();
function transact(fn) {
  const run = lock.then(() => {
    const data = readData();
    const { result, changed } = fn(data);
    if (changed) writeData(data);
    return result;
  });
  lock = run.catch(() => {});
  return run;
}

/* ---------- منطق الحجز ---------- */
function buildSeats(data, token) {
  const out = [];
  for (let i = 1; i <= SEAT_COUNT; i++) {
    const b = data[String(i)];
    if (!b) {
      out.push({ id: i, status: "free" });
    } else if (token && b.token === token) {
      out.push({ id: i, status: "mine", name: b.name });
    } else {
      out.push({ id: i, status: "booked" });
    }
  }
  return out;
}

function validateText(s, min, max) {
  s = String(s == null ? "" : s).trim();
  if (s.length < min || s.length > max) return null;
  return s;
}

function apiSeats(token) {
  return transact((data) => ({ result: { seats: buildSeats(data, token) }, changed: false }));
}

function apiBook({ seat, name, phone, token }) {
  seat = Number(seat);
  if (!Number.isInteger(seat) || seat < 1 || seat > SEAT_COUNT)
    throw new HttpError(400, "رقم كرسي غير صحيح");
  name = validateText(name, 3, 60);
  phone = validateText(phone, 8, 20);
  token = validateText(token, 8, 64);
  if (!name) throw new HttpError(400, "اكتب الاسم بالكامل");
  if (!phone || !/^0?1[0-25][0-9]{8,9}$/.test(phone))
    throw new HttpError(400, "رقم موبايل غير صحيح");
  if (!token) throw new HttpError(400, "توكن مفقود");

  return transact((data) => {
    const key = String(seat);
    const existing = data[key];
    if (existing && existing.token !== token)
      throw new HttpError(409, "الكرسي ده اتحجز لسه دلوقتي 😅");
    // كل شخص كرسي واحد: لو حجز كرسي تاني قديمه يتلغي تلقائياً
    for (const k of Object.keys(data)) {
      if (k !== key && data[k] && data[k].token === token) delete data[k];
    }
    data[key] = { seat, name, phone, token, at: Date.now() };
    return { result: { ok: true, seat }, changed: true };
  });
}

function apiCancel({ seat, token }) {
  seat = Number(seat);
  token = validateText(token, 8, 64);
  if (!Number.isInteger(seat) || seat < 1 || seat > SEAT_COUNT)
    throw new HttpError(400, "رقم كرسي غير صحيح");
  if (!token) throw new HttpError(400, "توكن مفقود");

  return transact((data) => {
    const key = String(seat);
    if (!data[key]) throw new HttpError(404, "الكرسي ده مش محجوز أصلاً");
    if (data[key].token !== token) throw new HttpError(403, "مش تقدر تلغي حجز غيرك");
    delete data[key];
    return { result: { ok: true, seat }, changed: true };
  });
}

/* ---------- HTTP ---------- */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "الطلب كبير أوي"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "JSON غير صالح"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, urlPath) {
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT)
    return sendJson(res, 403, { error: "ممنوع" });
  if (filePath.startsWith(DATA_DIR + path.sep))
    return sendJson(res, 403, { error: "ممنوع" });

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: "غير موجود" });
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const p = url.pathname;

  try {
    if (p.startsWith("/api/")) {
      const action = p.slice(5);
      const token = req.method === "GET" ? url.searchParams.get("token") : null;

      if (req.method === "GET" && action === "seats") {
        return sendJson(res, 200, await apiSeats(token));
      }
      if (req.method === "POST" && action === "book") {
        return sendJson(res, 200, await apiBook(await readBody(req)));
      }
      if (req.method === "POST" && action === "cancel") {
        return sendJson(res, 200, await apiCancel(await readBody(req)));
      }
      return sendJson(res, 404, { error: "API غير موجود" });
    }

    if (req.method !== "GET" && req.method !== "HEAD")
      return sendJson(res, 405, { error: "Method not allowed" });

    serveStatic(req, res, decodeURIComponent(p));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    sendJson(res, status, { error: e instanceof HttpError ? e.message : "خطأ في السيرفر" });
  }
});

server.listen(PORT, () => {
  console.log("✅ شغّال على http://localhost:" + PORT);
  console.log("📂 البيانات بتتخزن في: " + DATA_FILE);
});
