<?php
/*
  نسخة PHP لنظام حجز الكراسي — للاستضافة المشتركة (cPanel / أي استضافة Apache)
  المسارات زي نسخة Node بالظبط:  /api/seats  /api/book  /api/cancel
  البيانات بتتخزن في: ../data/bookings.json  (لازم فولدر data يكون قابل للكتابة)
*/
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const SEAT_COUNT = 28;

$DATA_FILE = dirname(__DIR__) . '/data/bookings.json';

function read_data($file) {
    if (!file_exists($file)) return array();
    $raw = @file_get_contents($file);
    $d = json_decode($raw, true);
    return is_array($d) ? $d : array();
}

function write_data($file, $data) {
    $dir = dirname($file);
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $tmp = $file . '.' . getmypid() . '.tmp';
    file_put_contents($tmp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    @rename($tmp, $file);
}

function fail($status, $msg) {
    http_response_code($status);
    echo json_encode(array('error' => $msg), JSON_UNESCAPED_UNICODE);
    exit;
}

function build_seats($data, $token) {
    $out = [];
    for ($i = 1; $i <= SEAT_COUNT; $i++) {
        $b = isset($data[$i]) ? $data[$i] : null;
        if ($b === null) {
            $out[] = ['id' => $i, 'status' => 'free'];
        } elseif ($token !== '' && isset($b['token']) && hash_equals($b['token'], $token)) {
            $out[] = ['id' => $i, 'status' => 'mine', 'name' => $b['name']];
        } else {
            $out[] = ['id' => $i, 'status' => 'booked'];
        }
    }
    return $out;
}

function clean($s, $min, $max) {
    $s = is_string($s) ? trim($s) : '';
    $len = function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : strlen($s);
    return ($len >= $min && $len <= $max) ? $s : null;
}

/* ---------- تحديد المسار ---------- */
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$action = isset($_GET['q']) ? $_GET['q'] : basename($uri); // seats | book | cancel
$method = $_SERVER['REQUEST_METHOD'];

$fp = @fopen($file_lock = $DATA_FILE . '.lock', 'c');
if ($fp) flock($fp, LOCK_EX); // قفل عشان مفيش حجزين مع بعض

try {
    if ($method === 'GET' && $action === 'seats') {
        $token = clean($_GET['token'] ?? '', 8, 64) ?: '';
        echo json_encode(['seats' => build_seats(read_data($DATA_FILE), $token)], JSON_UNESCAPED_UNICODE);
    } elseif ($method === 'POST' && $action === 'book') {
        $in = json_decode(file_get_contents('php://input'), true) ?: [];
        $seat   = isset($in['seat']) ? (int)$in['seat'] : 0;
        $name   = clean($in['name'] ?? '', 3, 60);
        $phone  = clean($in['phone'] ?? '', 8, 20);
        $token  = clean($in['token'] ?? '', 8, 64);
        if ($seat < 1 || $seat > SEAT_COUNT) fail(400, 'رقم كرسي غير صحيح');
        if ($name === null) fail(400, 'اكتب الاسم بالكامل');
        if ($phone === null || !preg_match('/^0?1[0-25][0-9]{8,9}$/', $phone)) fail(400, 'رقم موبايل غير صحيح');
        if ($token === null) fail(400, 'توكن مفقود');

        $data = read_data($DATA_FILE);
        if (isset($data[$seat]) && (!isset($data[$seat]['token']) || !hash_equals($data[$seat]['token'], $token)))
            fail(409, 'الكرسي ده اتحجز لسه دلوقتي 😅');
        // كل شخص كرسي واحد: لو حجز كرسي تاني قديمه يتلغي تلقائياً
        foreach (array_keys($data) as $k) {
            if ((int)$k !== $seat && isset($data[$k]['token']) && hash_equals($data[$k]['token'], $token))
                unset($data[$k]);
        }
        $data[$seat] = ['seat' => $seat, 'name' => $name, 'phone' => $phone, 'token' => $token, 'at' => time()];
        write_data($DATA_FILE, $data);
        echo json_encode(['ok' => true, 'seat' => $seat], JSON_UNESCAPED_UNICODE);
    } elseif ($method === 'POST' && $action === 'cancel') {
        $in = json_decode(file_get_contents('php://input'), true) ?: [];
        $seat  = isset($in['seat']) ? (int)$in['seat'] : 0;
        $token = clean($in['token'] ?? '', 8, 64);
        if ($seat < 1 || $seat > SEAT_COUNT) fail(400, 'رقم كرسي غير صحيح');
        if ($token === null) fail(400, 'توكن مفقود');

        $data = read_data($DATA_FILE);
        if (!isset($data[$seat])) fail(404, 'الكرسي ده مش محجوز أصلاً');
        if (!isset($data[$seat]['token']) || !hash_equals($data[$seat]['token'], $token))
            fail(403, 'مش تقدر تلغي حجز غيرك');
        unset($data[$seat]);
        write_data($DATA_FILE, $data);
        echo json_encode(['ok' => true, 'seat' => $seat], JSON_UNESCAPED_UNICODE);
    } else {
        fail(404, 'API غير موجود');
    }
} finally {
    if ($fp) { flock($fp, LOCK_UN); fclose($fp); }
}
