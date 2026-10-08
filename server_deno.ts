/**
 * نسخة Deno Deploy لنظام حجز كراسي الأتوبيس ٢٨ فرد
 * - تخزين دائم مدمج (Deno KV) متاح مجاناً في Deno Deploy
 * - تنفيذ ذري لعمليات الحجز (مافيش اتنين يحجزوا نفس الكرسي)
 * - نفس مسارات الـ API: /api/seats  /api/book  /api/cancel + ملفات الموقع
 */
const SEAT_COUNT = 28;
const MAX_BODY = 16 * 1024;

const kv = await Deno.openKv();
const BOOK_KEY = ["bookings"];

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** تعديل آمن مع إعادة المحاولة عند التعارض (أتمانيك) */
async function mutate(fn) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const cur = await kv.get(BOOK_KEY);
    const data = cur.value ? structuredClone(cur.value) : {};
    const out = fn(data);
    if (out.changed) {
      const commit = await kv.atomic()
        .check({ key: BOOK_KEY, versionstamp: cur.versionstamp })
        .set(BOOK_KEY, data)
        .commit();
      if (!commit.ok) continue; // حد غيّر البيانات في نفس اللحظة => حاول تاني
      return out.result;
    }
    return out.result;
  }
  throw new ApiError(503, "مشغولين شوية، جرّب تاني");
}

function buildSeats(data, token) {
  const out = [];
  for (let i = 1; i <= SEAT_COUNT; i++) {
    const b = data[String(i)];
    if (!b) out.push({ id: i, status: "free" });
    else if (token && b.token === token) out.push({ id: i, status: "mine", name: b.name });
    else out.push({ id: i, status: "booked" });
  }
  return out;
}

function clean(s, min, max) {
  s = String(s ?? "").trim();
  return s.length >= min && s.length <= max ? s : null;
}

/* ============ العمليات ============ */

async function seats(token) {
  return mutate((data) => ({
    result: json(200, { seats: buildSeats(data, token) }),
    changed: false,
  }));
}

async function book(body) {
  const seat = Number(body.seat);
  const name = clean(body.name, 3, 60);
  const phone = clean(body.phone, 8, 20);
  const token = clean(body.token, 8, 64);

  if (!Number.isInteger(seat) || seat < 1 || seat > SEAT_COUNT) throw new ApiError(400, "رقم كرسي غير صحيح");
  if (!name) throw new ApiError(400, "اكتب الاسم بالكامل");
  if (!phone || !/^0?1[0-25][0-9]{8,9}$/.test(phone)) throw new ApiError(400, "رقم موبايل غير صحيح");
  if (!token) throw new ApiError(400, "توكن مفقود");

  return mutate((data) => {
    const key = String(seat);
    const existing = data[key];
    if (existing && existing.token !== token) throw new ApiError(409, "الكرسي ده اتحجز لسه دلوقتي 😅");
    // كل شخص كرسي واحد: أي كرسي تاني بنفس التوكن يتلغي
    for (const k of Object.keys(data)) {
      if (k !== key && data[k] && data[k].token === token) delete data[k];
    }
    data[key] = { seat, name, phone, token, at: Date.now() };
    return { result: json(200, { ok: true, seat }), changed: true };
  });
}

async function cancel(body) {
  const seat = Number(body.seat);
  const token = clean(body.token, 8, 64);
  if (!Number.isInteger(seat) || seat < 1 || seat > SEAT_COUNT) throw new ApiError(400, "رقم كرسي غير صحيح");
  if (!token) throw new ApiError(400, "توكن مفقود");

  return mutate((data) => {
    const key = String(seat);
    if (!data[key]) throw new ApiError(404, "الكرسي ده مش محجوز أصلاً");
    if (data[key].token !== token) throw new ApiError(403, "مش تقدر تلغي حجز غيرك");
    delete data[key];
    return { result: json(200, { ok: true, seat }), changed: true };
  });
}

/* ============ الملفات الثابتة ============ */

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
};

function serveStatic(pathname) {
  const rel = (pathname === "/" ? "/index.html" : pathname).replace(/^\/+/, "");
  if (rel.includes("..")) return json(403, { error: "ممنوع" });
  const deny = ["server.js", "server_deno.ts", "package.json", "README.md", "data/", ".git/"];
  if (deny.some((d) => rel.startsWith(d))) return json(403, { error: "ممنوع" });

  return Deno.readFile(rel).then(
    (bytes) => new Response(bytes, {
      headers: {
        "Content-Type": MIME[rel.slice(rel.lastIndexOf(".")).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      },
    }),
    () => json(404, { error: "غير موجود" }),
  );
}

/* ============ الراوتر ============ */

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  try {
    if (pathname.startsWith("/api/")) {
      const action = pathname.slice(5);

      if (req.method === "GET" && action === "seats") {
        return await seats(url.searchParams.get("token"));
      }
      if (req.method === "POST" && action === "book") {
        return await book(await req.json());
      }
      if (req.method === "POST" && action === "cancel") {
        return await cancel(await req.json());
      }
      return json(404, { error: "API غير موجود" });
    }

    return await serveStatic(pathname);
  } catch (e) {
    if (e instanceof ApiError) return json(e.status, { error: e.message });
    if (e instanceof SyntaxError) return json(400, { error: "JSON غير صالح" });
    return json(500, { error: "خطأ في السيرفر" });
  }
});