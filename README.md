# 🚌 حجز كراسي أتوبيس ٢٨ فرد

رابط الناس تدخل عليه وتختار الكرسي اللي هتقعده — زي مواقع السوبر جيت بالظبط،
مع **حجز مشترك حقيقي**: أي حد يحجز كرسي، باقي الناس تشوفه محجوز فوراً.

## 🔗 الموقع الحي (Deno Deploy — مجاني، من غير كارت)

**https://alhagz.alhagz.deno.net**

- الحجوزات بتتحفظ في **Deno KV** (تخزين دائم مدمج مع الاستضافة).
- أي شخص يحجز → كل اللي فاتحين الصفحة يشوفوا الكرسي محجوز خلال ثواني.

## الملفات

| الملف | الوصف |
|---|---|
| `index.html` | صفحة الاختيار (تصميم موبايل أولاً) |
| `server_deno.ts` | ✅ السيرفر **الحالي المرفوع** على Deno Deploy (تخزين Deno KV + حجز آمن ذرياً) |
| `server.js` | سيرفر Node بدون مكتبات خارجية (نسخة بديلة) |
| `api/index.php` + `api/.htaccess` | نفس الـ API بـ PHP للاستضافة المشتركة (cPanel) |
| `data/bookings.json` | مكان التخزين لنسختي Node/PHP |

## ١. تجربة على جهازك

### نسخة Deno (نفس المرفوعة أونلاين)
```bash
deno run -A --unstable-kv server_deno.ts
```
افتح: **http://localhost:8000**

### نسخة Node
```bash
node server.js
```
افتح: **http://localhost:3000**

## ٢. رفعها على Deno Deploy (مجاني من غير كارت خالص)

1. اعمل حساب على https://console.deno.com (يسطرة بـ GitHub).
2. أنشيء تنظيم (Organization) — في الـ Settings بتاعه: **Organization Tokens → Create** وخد التوكن.
3. من داخل مجلد المشروع:
   ```bash
   $env:DENO_DEPLOY_TOKEN = "ddo_توكنك"
   deno deploy create --org اسم-التنظيم --app اسم-التطبيق `
     --source local --runtime-mode dynamic --entrypoint server_deno.ts `
     --do-not-use-detected-build-config --region global
   ```
4. أنشيء قاعدة Deno KV واربطها بالتطبيق:
   ```bash
   deno deploy database provision my-kv --kind denokv
   deno deploy database assign my-kv --app اسم-التطبيق
   ```
5. بعد أي تعديل: `deno deploy --org اسم-التنظيم --app اسم-التطبيق --prod`.

الرابط هيبقى شكل `https://اسم-التطبيق.اسم-التنظيم.deno.net`.

### بديل آخر: استضافة cPanel عادية
1. ارفع كل محتوى المجلد عبر File Manager.
2. اتأكد إن فولدر `data` موجود وصلاحيته **755 أو 775** (قابل للكتابة).
3. الاستضافة Apache هتلقى `api/.htaccess` تلقائياً → رابطك شغّال.

### بديل: استضافة Node (Render وغيرها)
1. ارفع الملفات.
2. أمر التشغيل: `node server.js` (بيراعي `PORT` من البيئة تلقائياً).
3. على Render: New → Web Service → اربط الريبو → Start Command: `node server.js`.

## إعدادات مهمة (في أول `<script>` داخل index.html)

```js
const TRIP_TITLE = "اختار كرسيك في الأتوبيس";
const SEAT_COUNT = 28;      // غيّرها لو عدد الكراسي اتغير
const POLL_MS    = 4000;    // سرعة تحديث الحجوزات (كل ٤ ثواني)
```

> لو ركّبتها على PHP وحبيت تغيّر `SEAT_COUNT`، غيّرها كمان في `api/index.php`.

## إزاي بيشتغل الحجز

- كل زائر بياخد **توكن عشوائي** محفوظ على جهازه بس (مش بنرسله لحد).
- لما يحجز: الاسم + الموبايل + التوكن بيتحفظوا في `data/bookings.json`.
- التوكن ده اللي بيسمحله بـ **إلغاء حجزه** بس — محدش يقدر يلغي حجز غيره.
- لو شخصين حجزوا نفس الكرسي في نفس اللحظة، واحد فيهم هيطلعله **409 "اتحجز لسه"**.
- مفيش تسجيل دخول ولا أي حاجة — تفتح اللينك وتختار وت玺.

## ملاحظات

- `data/bookings.json` بيتحجب عن الوصول المباشر من السيرفر (بيانات الموبايلات).
- الكود خفيف وبيشتغل على أي ماستشيف خفيف حتى مجاني.
