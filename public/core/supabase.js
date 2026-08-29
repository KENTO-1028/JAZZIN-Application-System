// ============================================================
// JAZZIN — core/supabase.js
// Supabase client + shared utilities
// ============================================================

// ── CONFIG (環境変数を Cloudflare Pages で設定) ─────────────
const SUPABASE_URL = window.__JAZZIN_SUPABASE_URL__ || 'https://kzdsrysnngnfupmszzvz.supabase.co';
const SUPABASE_ANON = window.__JAZZIN_SUPABASE_ANON__ || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6ZHNyeXNubmduZnVwbXN6enZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MDMyMjYsImV4cCI6MjA5NTA3OTIyNn0.9smzTzWG-ImlrslqpL-gZe9OF5rnAK4E15oeny2U3Xo';

// ✅ config.js が読み込まれていない・失敗した場合に気づけるようにする
if (SUPABASE_ANON === 'YOUR_ANON_KEY' || !SUPABASE_ANON) {
  console.error('[JAZZIN] Supabase anonキーが設定されていません。config.jsの読み込みを確認してください。');
}

// ── Client (CDN版 supabase-js v2) ──────────────────────────
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  realtime: { params: { eventsPerSecond: 10 } }
});

// ── Session token (ロック用 / DBに保存しない) ───────────────
let _sessionToken = sessionStorage.getItem('jazzin_session');
if (!_sessionToken) {
  _sessionToken = crypto.randomUUID();
  sessionStorage.setItem('jazzin_session', _sessionToken);
}
export const SESSION_TOKEN = _sessionToken;

// ── Seat status ─────────────────────────────────────────────
export const SeatStatus = Object.freeze({
  AVAILABLE:   'available',
  LOCKED:      'locked',
  RESERVED:    'reserved',
  CHECKED_IN:  'checked_in',
  SELECTED:    'selected',   // ローカルのみ
});

// ── Payment status ──────────────────────────────────────────
export const PaymentStatus = Object.freeze({
  UNPAID:     'unpaid',
  PAID_CASH:  'paid_cash',
});

// ── Event helpers ───────────────────────────────────────────
export async function fetchPublishedEvents() {
  const { data, error } = await supabase
    .from('event_availability')
    .select('id, title, event_at, venue_name, ticket_price, status, publish_at, hero_image_url, capacity, seats_available, seats_taken, seats_checked_in')
    .eq('status', 'published')
    .lte('publish_at', new Date().toISOString())
    .order('event_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function fetchEventDetail(eventId) {
  const { data, error } = await supabase
    .from('events')
    .select('id, title, description, performers, timetable, venue_name, venue_address, venue_lat, venue_lng, event_at, doors_open_at, hero_image_url, ticket_price, notes, capacity')
    .eq('id', eventId)
    .single();
  if (error) throw error;
  return data;
}

// ── Seat helpers ────────────────────────────────────────────
export async function fetchSeats(eventId) {
  // 期限切れロック自動解放（取得時）
  const now = new Date().toISOString();
  await supabase
    .from('seats')
    .update({ status: 'available', locked_by: null, locked_until: null })
    .eq('event_id', eventId)
    .eq('status', 'locked')
    .lt('locked_until', now);

  const { data, error } = await supabase
    .from('seats')
    .select('id, row_num, col_num, label, status')
    .eq('event_id', eventId)
    .order('row_num')
    .order('col_num');
  if (error) throw error;
  return data;
}

export async function lockSeats(eventId, seatIds) {
  const { data, error } = await supabase.rpc('lock_seats', {
    p_event_id:      eventId,
    p_seat_ids:      seatIds,
    p_session_token: SESSION_TOKEN,
  });
  if (error) throw error;
  return data; // boolean
}

// ✅ 仮ロック（キープ）を明示的に解除する。
//    予約フォームをキャンセルした時や、選択を取り消した時に呼ぶことで、
//    5分間の自動失効を待たずに他のお客様がすぐその座席を選べるようにする。
//    自分（同じSESSION_TOKEN）がロックした座席だけが対象。
// ✅ 仮ロック（キープ）を明示的に解除する。
//    予約フォームをキャンセルした時や、選択を取り消した時に呼ぶことで、
//    5分間の自動失効を待たずに他のお客様がすぐその座席を選べるようにする。
//    自分（同じSESSION_TOKEN）がロックした座席だけが対象。
// ✅ 予約情報の安全な取得（id + qr_token の両方一致が必須）。
//    reservations への直接の公開SELECTは廃止したため、公開ページからの
//    予約参照は必ずこのRPC経由で行う。
export async function getReservationSecure(id, token) {
  const { data, error } = await supabase.rpc('get_reservation_secure', {
    p_id: id, p_token: token,
  });
  if (error) throw error;
  return data;
}

// ✅ 予約番号＋メールアドレスの両方一致が必須（マイページの検索機能用）。
//    どちらか一方だけでは他人の予約を引き当てられないようにするため。
export async function findReservationByCodeEmail(code, email) {
  const { data, error } = await supabase.rpc('find_reservation_by_code_email', {
    p_code: code, p_email: email,
  });
  if (error) throw error;
  return data;
}

export async function releaseSeatLock(eventId, seatIds) {
  if (!seatIds || seatIds.length === 0) return { success: true };
  const { data, error } = await supabase.rpc('release_seat_lock', {
    p_event_id:      eventId,
    p_seat_ids:      seatIds,
    p_session_token: SESSION_TOKEN,
  });
  if (error) throw error;
  return data;
}

// ✅ タブを閉じる／ページ離脱時の保険。async処理が完了を待たれない場面でも
//    fetchのkeepaliveオプションでリクエストを送り切れるようにする。
export function releaseSeatLockBeacon(eventId, seatIds) {
  if (!seatIds || seatIds.length === 0) return;
  try {
    fetch(`${SUPABASE_URL}/rest/v1/rpc/release_seat_lock`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'apikey':        SUPABASE_ANON,
        'Authorization': `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({
        p_event_id:      eventId,
        p_seat_ids:      seatIds,
        p_session_token: SESSION_TOKEN,
      }),
    });
  } catch { /* ベストエフォートなので失敗しても何もしない */ }
}

export async function confirmReservation({
  eventId, seatIds, guestName, guestEmail, guestPhone, notes,
  guestNameKana, guestGender, guestAgeRange
}) {
  const { data, error } = await supabase.rpc('confirm_reservation', {
    p_event_id:        eventId,
    p_seat_ids:        seatIds,
    p_session_token:   SESSION_TOKEN,
    p_guest_name:      guestName,
    p_guest_email:     guestEmail,
    p_guest_phone:     guestPhone || null,
    p_notes:           notes || null,
    p_guest_name_kana: guestNameKana || null,
    p_guest_gender:    guestGender || null,
    p_guest_age_range: guestAgeRange || null,
  });
  if (error) throw error;
  return data; // { success, reservation_id, reservation_code, qr_token }
}

// ── Cancel helpers（管理者のみ実行可能。RPC側で認証チェック） ──
export async function cancelReservation(reservationId) {
  const { data, error } = await supabase.rpc('cancel_reservation', {
    p_reservation_id: reservationId,
  });
  if (error) throw error;
  return data; // { success, error? }
}

// ── Checkin helpers ─────────────────────────────────────────
export async function processCheckin(qrToken) {
  const { data, error } = await supabase.rpc('process_checkin', {
    p_qr_token:  qrToken,
    p_admin_id:  (await supabase.auth.getUser()).data?.user?.id || null,
  });
  if (error) throw error;
  return data;
}

export async function completeCheckin(reservationId) {
  const { data, error } = await supabase.rpc('complete_checkin', {
    p_reservation_id: reservationId,
    p_admin_id:  (await supabase.auth.getUser()).data?.user?.id || null,
  });
  if (error) throw error;
  return data;
}

// ── Auth helpers ────────────────────────────────────────────
export async function signInAdmin(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// ✅ イベント削除：関連データ（座席・予約・チェックイン・採番カウンター）を
//    すべて含めて安全にまとめて削除するRPCを呼ぶ。
//    クライアント側で個別にdeleteを積み重ねる方式は、RLS権限がテーブルごとに
//    異なるとエラーを出さず一部だけ削除漏れするリスクがあるため廃止した。
export async function deleteEvent(eventId) {
  const { data, error } = await supabase.rpc('delete_event', { p_event_id: eventId });
  if (error) throw error;
  return data; // { success, error? }
}

export async function getAdminUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

// ── お礼メール（管理画面から手動送信） ────────────────────────
// 既存の send-confirmation-email Edge Function（Gmail送信基盤）を
// 新しい mode:"send_thank_you_emails" で再利用する。
// 予約確認メール・前日リマインダーの既存コード（mode未指定 / send_event_reminders）は一切変更していない。
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/send-confirmation-email`;

export async function sendThankYouEmails({ eventId, reservationIds, subject, bodyTemplate }) {
  // ✅ 一斉送信は管理者本人のログインセッション（JWT）で認証する。
  //    公開のanonキーだけでは呼べないようにするため。
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error('ログインセッションが切れています。再ログインしてください');

  const res = await fetch(EDGE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey':        SUPABASE_ANON,
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      mode:            'send_thank_you_emails',
      event_id:        eventId,
      reservation_ids: reservationIds,
      subject,
      body_template:   bodyTemplate,
    }),
  });
  const data = await res.json();
  if (!res.ok && !data?.error) throw new Error(`送信リクエスト失敗 (${res.status})`);
  return data;
}

// ── キャンセル申請（予約者本人） ───────────────────────────────
export async function submitCancellationRequest({ reservationId, qrToken, reason }) {
  const { data, error } = await supabase.rpc('submit_cancellation_request', {
    p_reservation_id: reservationId,
    p_qr_token:       qrToken,
    p_reason:         reason,
  });
  if (error) throw error;

  // ✅ 申請自体は上のRPCで保存済み。管理者への通知メールはベストエフォート
  //    （通知メールが多少遅れて失敗しても、管理画面から確認はできるため致命的ではない）
  if (data?.success) {
    try {
      const { data: rsvInfo } = await supabase
        .from('reservations')
        .select('guest_name, guest_email, event:events(title), reservation_seats(seat:seats(label))')
        .eq('id', reservationId).single();
      if (rsvInfo) {
        const seatLabels = (rsvInfo.reservation_seats || []).map(rs => rs.seat?.label).filter(Boolean).join('、');
        await fetch(EDGE_FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` },
          body: JSON.stringify({
            mode: 'notify_admin_cancellation_request',
            event_title: rsvInfo.event?.title || '',
            guest_name:  rsvInfo.guest_name,
            guest_email: rsvInfo.guest_email,
            seat_labels: seatLabels,
            reason,
          }),
        });
      }
    } catch (err) {
      console.error('[JAZZIN] 管理者通知メール送信失敗:', err);
    }
  }
  return data;
}

// ── キャンセル申請（管理画面：承認・却下・返信メール・キャンセル待ち通知） ──
export async function approveCancellationRequest(requestId) {
  const { data, error } = await supabase.rpc('approve_cancellation_request', { p_request_id: requestId });
  if (error) throw error;
  return data;
}

export async function rejectCancellationRequest(requestId, adminNote) {
  const { data, error } = await supabase.rpc('reject_cancellation_request', {
    p_request_id: requestId,
    p_admin_note: adminNote || null,
  });
  if (error) throw error;
  return data;
}

export async function sendCancellationResponseEmail({ reservationId, guestName, guestEmail, eventTitle, subject, bodyTemplate }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error('ログインセッションが切れています。再ログインしてください');

  const res = await fetch(EDGE_FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      mode: 'send_cancellation_response_email',
      reservation_id: reservationId,
      guest_name:  guestName,
      guest_email: guestEmail,
      event_title: eventTitle,
      subject,
      body_template: bodyTemplate,
    }),
  });
  const data = await res.json();
  if (!res.ok && !data?.error) throw new Error(`送信リクエスト失敗 (${res.status})`);
  return data;
}

export async function notifyWaitlist(eventId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return { success: false };

  const res = await fetch(EDGE_FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ mode: 'notify_waitlist', event_id: eventId }),
  });
  return await res.json();
}

// ── キャンセル待ち登録（予約者本人・誰でも実行可） ────────────────
export async function joinWaitlist({ eventId, guestName, guestEmail, guestPhone, numSeats }) {
  const { data, error } = await supabase.rpc('join_waitlist', {
    p_event_id:    eventId,
    p_guest_name:  guestName,
    p_guest_email: guestEmail,
    p_guest_phone: guestPhone || null,
    p_num_seats:   numSeats || 1,
  });
  if (error) throw error;
  return data;
}

// ── Realtime ────────────────────────────────────────────────
export function subscribeSeats(eventId, onSeatChange) {
  return supabase
    .channel(`seats:${eventId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'seats',
      filter: `event_id=eq.${eventId}`,
    }, payload => {
      onSeatChange(payload.new); // 差分のみ、全体再描画禁止
    })
    .subscribe();
}

// ── Format helpers ──────────────────────────────────────────
export function formatDate(iso) {
  if (!iso) return "日時未定";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "日時未定";
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

export function formatPrice(yen) {
  return `¥${yen.toLocaleString('ja-JP')}`;
}

export function availabilityLabel(available, capacity) {
  if (available === 0) return { text: 'SOLD OUT', cls: 'badge-sold' };
  if (available / capacity <= 0.2) return { text: '残りわずか', cls: 'badge-few' };
  return { text: '空席あり', cls: 'badge-ok' };
}

// ── EmailJS ─────────────────────────────────────────────────
export async function sendConfirmationEmail({ toEmail, toName, eventTitle, eventAt, venueName, seats, numSeats, price, reservationCode, qrToken, notes }) {
  if (!window.emailjs) return;
  return emailjs.send('SERVICE_ID', 'TEMPLATE_CONFIRM', {
    to_email:         toEmail,
    to_name:          toName,
    event_title:      eventTitle,
    event_at:         formatDate(eventAt),
    venue_name:       venueName,
    seats:            seats,
    num_seats:        numSeats,
    price:            formatPrice(price * numSeats),
    reservation_code: reservationCode,
    qr_token:         qrToken,
    notes:            notes || '',
  });
}