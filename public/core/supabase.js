// ============================================================
// JAZZIN — core/supabase.js
// Supabase client + shared utilities
// ============================================================

// ── CONFIG (環境変数を Cloudflare Pages で設定) ─────────────
const SUPABASE_URL = window.__JAZZIN_SUPABASE_URL__ || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON = window.__JAZZIN_SUPABASE_ANON__ || 'YOUR_ANON_KEY';

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

export async function confirmReservation({
  eventId, seatIds, guestName, guestEmail, guestPhone, notes
}) {
  const { data, error } = await supabase.rpc('confirm_reservation', {
    p_event_id:      eventId,
    p_seat_ids:      seatIds,
    p_session_token: SESSION_TOKEN,
    p_guest_name:    guestName,
    p_guest_email:   guestEmail,
    p_guest_phone:   guestPhone || null,
    p_notes:         notes || null,
  });
  if (error) throw error;
  return data; // { success, reservation_id, reservation_code, qr_token }
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

export async function getAdminUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
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