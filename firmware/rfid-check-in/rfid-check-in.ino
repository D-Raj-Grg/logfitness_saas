// rfid-check-in.ino -- Lord of Gyms RFID door reader
//
// ESP32 DevKit + RC522 (SPI) + DS3231 RTC + 128x64 SSD1306 OLED (I2C) + buzzer.
// A member taps their card; the reader POSTs the UID to the rfid-check Edge
// Function, which records the visit and answers allow/deny. The OLED and the
// buzzer show the answer.
//
// Offline mode (fw 1.1.0): the reader keeps a copy of the allow-list ("this
// card may enter until <date>") in flash, refreshed from the rfid-sync Edge
// Function. When the server cannot be reached it decides from that copy, queues
// the tap, and uploads the queue once the network is back. The copy is trusted
// until the next sync -- a card revoked or newly in arrears keeps working
// offline until then.
//
// Settings live in config.h (copy config.h.example -> config.h). See README.md.
//
// Board: "ESP32 Dev Module", ESP32 Arduino core 2.x, Arduino IDE 1.8.19.
// Libraries: MFRC522 (GithubCommunity), RTClib (Adafruit), Adafruit GFX,
// Adafruit SSD1306, ArduinoJson 6.x. LittleFS ships with the ESP32 core.

#include <WiFi.h>
#include <LittleFS.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <RTClib.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <time.h>
// sntp_set_time_sync_notification_cb() is declared in esp_sntp.h on core 3.x
// (IDF 5) and in both esp_sntp.h and sntp.h on core 2.x (IDF 4.4).
#if __has_include(<esp_sntp.h>)
  #include <esp_sntp.h>
#elif __has_include(<sntp.h>)
  #include <sntp.h>
#else
  #error "No esp_sntp.h or sntp.h: install the ESP32 Arduino core (2.x or 3.x)"
#endif

#include "config.h"

#ifndef RFID_SYNC_ENDPOINT
#error "config.h is missing RFID_SYNC_ENDPOINT: copy the line from config.h.example"
#endif

// ---------------------------------------------------------------------------
// Pins (fixed by the wiring; see README.md)
// ---------------------------------------------------------------------------
#define RC522_SS    5    // VSPI SS / SDA on the RC522 board
#define RC522_RST   27
#define SPI_SCK     18
#define SPI_MISO    19
#define SPI_MOSI    23
#define I2C_SDA     21   // shared by DS3231 and OLED
#define I2C_SCL     22

#ifndef BUZZER_PIN
#define BUZZER_PIN  25
#endif
#ifndef BUZZER_ACTIVE_HIGH
#define BUZZER_ACTIVE_HIGH 1
#endif
#ifndef BTN_K1_PIN
#define BTN_K1_PIN  -1
#endif
#ifndef BTN_K2_PIN
#define BTN_K2_PIN  -1
#endif
#ifndef BTN_K3_PIN
#define BTN_K3_PIN  -1
#endif
#ifndef BTN_K4_PIN
#define BTN_K4_PIN  -1
#endif

// Door relay (HW-482 style transistor board: coil on 5 V, IN driven by a 3.3 V
// GPIO, energised when IN is HIGH). Opens for RELAY_OPEN_MS after an allowed tap.
#ifndef RELAY_PIN
#define RELAY_PIN   26
#endif
#ifndef RELAY_ACTIVE_HIGH
#define RELAY_ACTIVE_HIGH 1
#endif
#ifndef RELAY_OPEN_MS
#define RELAY_OPEN_MS 3000
#endif

// WiFi settings page (plain HTTP, LAN only). An empty WEB_PASSWORD disables it.
#ifndef WEB_USER
#define WEB_USER "admin"
#endif
#ifndef WEB_PASSWORD
#define WEB_PASSWORD ""
#endif

// Settings menu lock: hold K4 for 3 s, then press this code on K1..K4
// (digits '1'..'4'). An empty string opens the menu without a code.
#ifndef SETTINGS_PIN
#define SETTINGS_PIN "1234"
#endif

#define OLED_ADDR   0x3C
#define OLED_W      128
#define OLED_H      64

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------
#define FW_VERSION            "1.1.0"
#define TZ_OFFSET_SEC         (5 * 3600 + 45 * 60)  // Nepal, UTC+5:45, no DST
#define HTTP_TIMEOUT_MS       8000
#define HTTP_TIMEOUT_DOWN_MS  5000UL   // after a failure, fail faster (TLS alone can take 2-3 s)
#define SERVER_DOWN_WINDOW_MS 60000UL  // ...for this long, then try the full timeout again

// Offline mode
#define CARDS_FILE            "/cards.bin"
#define CARDS_TMP_FILE        "/cards.new"
#define META_FILE             "/meta.bin"
#define EVENTS_FILE           "/events.bin"
#define EVENTS_TMP_FILE       "/events.new"
#define UID_HEX_MAX           20       // matches member_cards.card_uid (8..20 hex)
#define EVENTS_MAX            2000     // ~48 KB; taps beyond this are not queued
#define UPLOAD_BATCH          50
#define SYNC_PAGE_LIMIT       500
#define SYNC_INTERVAL_MS      (15UL * 60UL * 1000UL)
#define SYNC_RETRY_MS         (60UL * 1000UL)
#define UPLOAD_RETRY_MS       (30UL * 1000UL)
#define UPLOAD_RETRY_BADKEY_MS (5UL * 60UL * 1000UL)  // 401/403: the key will not fix itself
#define SYNC_RETRY_BADKEY_MS  (5UL * 60UL * 1000UL)
#define BG_TIMEOUT_MS         4000UL   // background sync/upload: never hold the door long
#define RESULT_HOLD_MS        3000UL
#define SAME_UID_DEBOUNCE_MS  3000UL
#define INFO_HOLD_MS          5000UL
#define WIFI_BOOT_WAIT_MS     20000UL
#define WIFI_RETRY_MS         15000UL
#define NTP_WAIT_MS           15000UL
#define NTP_RETRY_MS          (10UL * 60UL * 1000UL)
#define NTP_RESYNC_MS         (24UL * 60UL * 60UL * 1000UL)
#define RC522_CHECK_MS        60000UL
#define IDLE_REDRAW_MS        1000UL
#define MIN_VALID_YEAR        2024
#define BTN_DEBOUNCE_MS       40UL
#define MENU_LONG_PRESS_MS    3000UL   // hold K4 on the idle screen
#define MENU_IDLE_TIMEOUT_MS  30000UL
#define PIN_IDLE_TIMEOUT_MS   15000UL
#define SETTINGS_FILE         "/settings.bin"
#define SETTINGS_MAGIC        0x4C4F5332UL  // "LOS2"
#define WEB_MAX_FAILS         5
#define WEB_LOCKOUT_MS        60000UL
#define TAP_LOG_N             10
#define NAME_MAX_CHARS        20

// ---------------------------------------------------------------------------
// Types (declared before any function so the IDE's auto-prototypes compile)
// ---------------------------------------------------------------------------
enum ReaderState { ST_IDLE, ST_RESULT, ST_INFO, ST_PIN, ST_MENU };

enum ResultKind {
  RES_ALLOW,      // 200 + decision "allow"
  RES_DENY,       // 200 + decision "deny"
  RES_KEY_BAD,    // 401: device key unknown
  RES_DISABLED,   // 403: device disabled in the console
  RES_OFFLINE,    // no WiFi, timeout, 5xx, unparseable body ... and no usable cache
  RES_OFFLINE_ALLOW  // server unreachable, but the cached allow-list says yes
};

enum CacheVerdict {
  CV_NO_CACHE,   // never synced, or the cache file is unreadable
  CV_UNKNOWN,    // no live card with this UID in the list
  CV_ALLOW,      // status A and still inside its date
  CV_EXPIRED,    // status E, or A but the day has passed
  CV_FROZEN,
  CV_UPCOMING,   // membership not started yet
  CV_NONE,       // card assigned, member never bought a membership
  CV_LEFT,
  CV_DUES
};

// One entry in /cards.bin: the card UID as upper-case hex text (NUL-padded),
// the member's status code and, for status 'A' (allowed), the last day
// (YYYYMMDD) the card may enter. Codes: A allowed, D dues owing, E expired,
// F frozen, U not started, N no membership, L left. Same letters rfid-sync sends.
struct CardRec {
  char uid[UID_HEX_MAX];
  uint32_t until;
  char st;
  char pad[3];
};

// One queued offline tap in /events.bin. ts is Unix seconds (UTC), 0 if the
// clock was not set (the server then records the upload time).
struct EventRec {
  char uid[UID_HEX_MAX];
  uint32_t ts;
};

// /meta.bin: when the cache was last refreshed.
struct CacheMeta {
  uint32_t magic;
  uint32_t syncDay;     // org-local YYYYMMDD at the last full sync
  uint32_t count;       // cards in /cards.bin
};
#define META_MAGIC 0x4C4F4731UL  // "LOG1"

// Reader settings kept in /settings.bin. The offline test switch is deliberately
// NOT in here: it lives only in RAM, so a reboot always returns to normal.
struct Settings {
  uint32_t magic;
  uint8_t relayOn;
  uint8_t soundOn;
  uint16_t openMs;
};

enum MenuItem {
  MI_OFFLINE_TEST,
  MI_RELAY,
  MI_OPEN_TIME,
  MI_RELAY_TEST,
  MI_SOUND,
  MI_SOUND_TEST,
  MI_SYNC_NOW,
  MI_BACK,
  MI_COUNT
};

// Last few door results, newest first when read back; shown on the web page.
struct TapLog {
  uint32_t localSecs;   // seconds since 1970 in local time; 0 = clock not set
  char tail[5];         // last 4 hex digits of the UID only
  char what[16];        // "ALLOW", "OFFLINE ALLOW", "DENY dues", ...
};

struct CheckResult {
  ResultKind kind;
  int httpCode;
  char reason[20];
  char name[NAME_MAX_CHARS + 1];
  char code[17];
  char status[12];
  bool hasDays;
  long days;
  long duePaisa;
  bool alreadyIn;
  uint32_t until;  // RES_OFFLINE_ALLOW: last day (YYYYMMDD) the cached card may enter
  bool notLogged;  // RES_OFFLINE_ALLOW: the tap could not be queued (queue full / no flash)
};

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
MFRC522 rfid(RC522_SS, RC522_RST);
RTC_DS3231 rtc;
Adafruit_SSD1306 display(OLED_W, OLED_H, &Wire, -1);

ReaderState state = ST_IDLE;
uint32_t stateSinceMs = 0;
uint32_t lastIdleDrawMs = 0;

bool oledOk = false;
bool rtcOk = false;
bool rtcTimeValid = false;

bool wifiWasConnected = false;
uint32_t lastWifiAttemptMs = 0;

bool ntpPending = false;
volatile bool ntpFreshReply = false;  // set by the SNTP callback (lwIP task)
bool ntpEverSynced = false;
uint32_t ntpStartMs = 0;
uint32_t lastNtpSyncMs = 0;
uint32_t lastNtpAttemptMs = 0;

uint32_t lastRc522CheckMs = 0;

char lastUid[21] = "";
uint32_t lastUidMs = 0;

// Settings, relay, keypad, menu
Settings settings = { SETTINGS_MAGIC, 1, 1, (uint16_t)RELAY_OPEN_MS };
bool testOffline = false;         // menu "Offline test": skip the server, decide from the cache
bool relayActive = false;
uint32_t relayUntilMs = 0;

const int8_t BTN_PINS[4] = { BTN_K1_PIN, BTN_K2_PIN, BTN_K3_PIN, BTN_K4_PIN };
bool btnDown[4] = { false, false, false, false };
uint32_t btnChangeMs[4] = { 0, 0, 0, 0 };
uint32_t btnDownSinceMs[4] = { 0, 0, 0, 0 };
bool k4LongFired = false;         // set once per hold, consumed by loop()
uint8_t menuIdx = 0;
uint32_t menuLastKeyMs = 0;
char pinEntered[9] = "";

// WiFi settings page
WebServer web(80);
bool webStarted = false;
char webToken[17] = "";
uint8_t webFails = 0;
bool webLockOn = false;
uint32_t webLockUntilMs = 0;
TapLog tapLog[TAP_LOG_N];
uint8_t tapLogHead = 0;     // next slot to write
uint8_t tapLogCount = 0;

// Offline mode state
bool fsOk = false;
uint8_t serverFailStreak = 0;     // consecutive RES_OFFLINE answers while WiFi was up
uint32_t serverFailAtMs = 0;      // when the last one happened

bool syncActive = false;          // a multi-page sync is in progress
bool syncEverDone = false;
bool syncDue = true;              // sync as soon as WiFi is up, then every SYNC_INTERVAL_MS
bool syncBackoffOn = false;       // a failed sync waits until syncBackoffUntilMs
uint32_t syncBackoffUntilMs = 0;  // (a flag, not "0 = none": signed millis() compares flip at ~25 days)
uint32_t uploadRetryMs = UPLOAD_RETRY_MS;
uint32_t lastSyncOkMs = 0;
char syncAfter[UID_HEX_MAX + 1] = "";  // keyset cursor for the next page
uint32_t syncPages = 0;
uint32_t syncCount = 0;
File syncFile;

uint32_t lastUploadAttemptMs = 0;
uint32_t eventsQueued = 0;        // mirror of /events.bin, refreshed on change
uint32_t cardsCached = 0;         // mirror of /meta.bin count
uint32_t cacheSyncDay = 0;        // org-local YYYYMMDD of the last sync (0 = never)

// Beep patterns: alternating on/off durations in ms, starting with "on".
// An active buzzer has one pitch, so each outcome gets its own rhythm:
//   in              1 short
//   in, expiring    2 short            (7 days or fewer left: tell them at the door)
//   in, offline     short + medium     (the server did not answer; cached list)
//   unknown/misread 3 short            (send them to the desk)
//   dues owing      2 long
//   any other no    1 very long        (expired, frozen, not started, left, errors)
const uint16_t BEEP_SHORT[]   = { 120 };
const uint16_t BEEP_DOUBLE[]  = { 120, 100, 120 };
const uint16_t BEEP_OFFLINE[] = { 120, 100, 350 };
const uint16_t BEEP_TRIPLE[]  = { 120, 100, 120, 100, 120 };
const uint16_t BEEP_DUES[]    = { 400, 150, 400 };
const uint16_t BEEP_LONG[]    = { 800 };
// Menu "Sound test": short, double, very long.
const uint16_t BEEP_TEST[]    = { 120, 350, 120, 100, 120, 350, 800 };
#define PATTERN_LEN(p) ((uint8_t)(sizeof(p) / sizeof((p)[0])))

const uint16_t *beepPattern = nullptr;
uint8_t beepLen = 0;
uint8_t beepIdx = 0;
uint32_t beepStepMs = 0;

// ---------------------------------------------------------------------------
// Buzzer (non-blocking pattern player)
// ---------------------------------------------------------------------------
void buzzerWrite(bool on) {
  digitalWrite(BUZZER_PIN, (on == (BUZZER_ACTIVE_HIGH != 0)) ? HIGH : LOW);
}

// Play regardless of the Sound setting (used by the menu's Sound test).
void startBeepAlways(const uint16_t *pattern, uint8_t len) {
  beepPattern = pattern;
  beepLen = len;
  beepIdx = 0;
  beepStepMs = millis();
  buzzerWrite(true);
}

void startBeep(const uint16_t *pattern, uint8_t len) {
  if (!settings.soundOn) return;
  startBeepAlways(pattern, len);
}

void updateBeep() {
  if (beepPattern == nullptr) return;
  if (millis() - beepStepMs < beepPattern[beepIdx]) return;
  beepIdx++;
  beepStepMs = millis();
  if (beepIdx >= beepLen) {
    buzzerWrite(false);
    beepPattern = nullptr;
    return;
  }
  buzzerWrite(beepIdx % 2 == 0);  // even steps on, odd steps off
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
bool i2cPresent(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

// Copy for the OLED: ASCII only (the GFX font has no Devanagari), one '?'
// per non-ASCII character, at most maxChars characters.
void copyDisplayText(char *dst, size_t dstSize, const char *src, size_t maxChars) {
  size_t n = 0;
  if (dstSize == 0) return;
  if (maxChars > dstSize - 1) maxChars = dstSize - 1;
  for (const char *p = src; p != nullptr && *p != '\0' && n < maxChars; p++) {
    uint8_t c = (uint8_t)*p;
    if (c >= 0x20 && c < 0x7F) {
      dst[n++] = (char)c;
    } else if (c >= 0xC0) {
      dst[n++] = '?';  // UTF-8 lead byte; continuation bytes are skipped
    }
  }
  dst[n] = '\0';
}

// Rupees from paisa, grouped like the console (en-IN: 1,23,456.5). Paisa are
// dropped from Rs 1,00,000 up so the line always fits 21 characters.
void formatRupees(char *out, size_t outSize, long paisa) {
  if (paisa < 0) paisa = 0;
  long rs = paisa / 100;
  long ps = paisa % 100;
  char digits[16];
  char grouped[24];
  snprintf(digits, sizeof(digits), "%ld", rs);
  int len = (int)strlen(digits);
  int g = 0;
  for (int i = 0; i < len; i++) {
    int left = len - i;  // digits still to copy, including this one
    if (i > 0 && (left == 3 || (left > 3 && (left - 3) % 2 == 0))) grouped[g++] = ',';
    grouped[g++] = digits[i];
  }
  grouped[g] = '\0';
  if (ps == 0 || rs >= 100000) snprintf(out, outSize, "Rs %s", grouped);
  else if (ps % 10 == 0) snprintf(out, outSize, "Rs %s.%ld", grouped, ps / 10);
  else snprintf(out, outSize, "Rs %s.%02ld", grouped, ps);
}

void readUidHex(char *out, size_t outSize) {
  size_t pos = 0;
  out[0] = '\0';
  for (byte i = 0; i < rfid.uid.size && pos + 2 < outSize; i++) {
    snprintf(out + pos, outSize - pos, "%02X", rfid.uid.uidByte[i]);
    pos += 2;
  }
}

// The RTC holds Nepal local time (so it reads naturally on the idle screen);
// the server wants real Unix seconds (UTC), so the offset is removed here.
uint32_t rtcUnixUtc() {
  return rtc.now().unixtime() - (uint32_t)TZ_OFFSET_SEC;
}

void formatRtc(char *out, size_t outSize, bool withDate) {
  if (!rtcOk || !rtcTimeValid) {
    snprintf(out, outSize, "%s", withDate ? "RTC not set" : "--:--");
    return;
  }
  DateTime t = rtc.now();
  if (withDate) {
    snprintf(out, outSize, "%04d-%02d-%02d %02d:%02d:%02d",
             t.year(), t.month(), t.day(), t.hour(), t.minute(), t.second());
  } else {
    snprintf(out, outSize, "%02d:%02d", t.hour(), t.minute());
  }
}

// ---------------------------------------------------------------------------
// OLED screens
// ---------------------------------------------------------------------------
void printCentered(const char *text, int16_t y, uint8_t size) {
  int16_t w = (int16_t)strlen(text) * 6 * size;
  int16_t x = (OLED_W - w) / 2;
  if (x < 0) x = 0;
  display.setTextSize(size);
  display.setCursor(x, y);
  display.print(text);
}

void showMessage(const char *line1, const char *line2, const char *line3) {
  Serial.printf("[oled] %s | %s | %s\n", line1, line2, line3);
  if (!oledOk) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  printCentered(line1, 8, 2);
  printCentered(line2, 34, 1);
  printCentered(line3, 48, 1);
  display.display();
}

void drawIdle() {
  if (!oledOk) return;
  char label[22];
  char hhmm[8];
  char dateLine[22];

  copyDisplayText(label, sizeof(label), DEVICE_LABEL, 13);
  formatRtc(hhmm, sizeof(hhmm), false);
  if (rtcOk && rtcTimeValid) {
    static const char *const DAYS[] = { "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" };
    static const char *const MONTHS[] = { "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };
    DateTime t = rtc.now();
    snprintf(dateLine, sizeof(dateLine), "%s %d %s %d",
             DAYS[t.dayOfTheWeek() % 7], t.day(), MONTHS[(t.month() + 11) % 12], t.year());
  } else {
    snprintf(dateLine, sizeof(dateLine), "%s", rtcOk ? "Clock not set" : "RTC error");
  }
  if (testOffline) snprintf(dateLine, sizeof(dateLine), "* OFFLINE TEST *");

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(label);
  const char *net = (WiFi.status() == WL_CONNECTED) ? "WiFi" : "NO WIFI";
  display.setCursor(OLED_W - (int16_t)strlen(net) * 6, 0);
  display.print(net);

  printCentered(hhmm, 12, 3);       // 18x24 px glyphs, y 12..35
  printCentered(dateLine, 38, 1);   // y 38..45
  printCentered("TAP CARD", 48, 2); // y 48..63
  display.display();
}

void drawInfo() {
  char line[24];
  char label[22];
  copyDisplayText(label, sizeof(label), DEVICE_LABEL, 21);

  Serial.println("[info] showing info screen");
  if (!oledOk) return;
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  display.setCursor(0, 0);
  display.print(label);

  display.setCursor(0, 12);
  if (WiFi.status() == WL_CONNECTED) {
    display.print("IP ");
    display.print(WiFi.localIP().toString());
  } else {
    display.print("WiFi not connected");
  }

  display.setCursor(0, 24);
  if (WiFi.status() == WL_CONNECTED) {
    snprintf(line, sizeof(line), "RSSI %d dBm", (int)WiFi.RSSI());
  } else {
    snprintf(line, sizeof(line), "RSSI --");
  }
  display.print(line);

  formatRtc(line, sizeof(line), true);
  display.setCursor(0, 36);
  display.print(line);

  display.setCursor(0, 48);
  snprintf(line, sizeof(line), "FW %s C%lu Q%lu", FW_VERSION,
           (unsigned long)cardsCached, (unsigned long)eventsQueued);
  display.print(line);
  display.display();
}

void drawResult(const CheckResult &r) {
  char big[12];
  char line1[22];
  char line2[22];
  line1[0] = '\0';
  line2[0] = '\0';

  switch (r.kind) {
    case RES_ALLOW:
      snprintf(big, sizeof(big), "ALLOW");
      if (r.alreadyIn) {
        snprintf(line1, sizeof(line1), "ALREADY IN");
      } else {
        snprintf(line1, sizeof(line1), "WELCOME");
      }
      if (r.hasDays) formatDaysLeft(line2, sizeof(line2), r.days);
      break;

    case RES_DENY:
      snprintf(big, sizeof(big), "DENY");
      if (strcmp(r.reason, "dues") == 0) {
        snprintf(line1, sizeof(line1), "PAY DUES");
        if (r.duePaisa > 0) formatRupees(line2, sizeof(line2), r.duePaisa);  // not known offline
      } else if (strcmp(r.reason, "expired") == 0) {
        snprintf(line1, sizeof(line1), "EXPIRED");
      } else if (strcmp(r.reason, "frozen") == 0) {
        snprintf(line1, sizeof(line1), "FROZEN");
      } else if (strcmp(r.reason, "upcoming") == 0) {
        snprintf(line1, sizeof(line1), "NOT STARTED YET");
      } else if (strcmp(r.reason, "none") == 0) {
        snprintf(line1, sizeof(line1), "NO MEMBERSHIP");
      } else if (strcmp(r.reason, "left") == 0) {
        snprintf(line1, sizeof(line1), "NOT A MEMBER");
      } else if (strcmp(r.reason, "unknown_card") == 0) {
        snprintf(line1, sizeof(line1), "UNKNOWN CARD");
        snprintf(line2, sizeof(line2), "Ask desk to assign");
      } else if (strcmp(r.reason, "bad_uid") == 0) {
        snprintf(line1, sizeof(line1), "BAD READ");
        snprintf(line2, sizeof(line2), "Tap again");
      } else {
        copyDisplayText(line1, sizeof(line1), r.reason, 21);
      }
      if (line2[0] == '\0') snprintf(line2, sizeof(line2), "See front desk");
      break;

    case RES_KEY_BAD:
      snprintf(big, sizeof(big), "SETUP");
      snprintf(line1, sizeof(line1), "DEVICE KEY UNKNOWN");
      snprintf(line2, sizeof(line2), "Check config.h");
      break;

    case RES_DISABLED:
      snprintf(big, sizeof(big), "DISABLED");
      snprintf(line1, sizeof(line1), "READER DISABLED");
      snprintf(line2, sizeof(line2), "Enable in console");
      break;

    case RES_OFFLINE_ALLOW:
      snprintf(big, sizeof(big), "ALLOW");
      snprintf(line1, sizeof(line1), "%s", r.notLogged ? "NOT LOGGED" : "OFFLINE MODE");
      if (r.hasDays) formatDaysLeft(line2, sizeof(line2), r.days);
      else snprintf(line2, sizeof(line2), "No Expiry");
      break;

    case RES_OFFLINE:
    default:
      snprintf(big, sizeof(big), "OFFLINE");
      snprintf(line1, sizeof(line1), "NOT RECORDED");
      if (r.httpCode > 0) snprintf(line2, sizeof(line2), "HTTP %d", r.httpCode);
      else if (WiFi.status() != WL_CONNECTED) snprintf(line2, sizeof(line2), "No WiFi");
      else snprintf(line2, sizeof(line2), "No server reply");
      break;
  }

  Serial.printf("[result] %s | %s | %s | %s\n", r.name, big, line1, line2);
  if (!oledOk) return;

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(r.name);            // y 0..7, <= 20 chars
  if (r.code[0] != '\0') {
    display.setCursor(0, 10);
    display.print(r.code);          // y 10..17
  }
  printCentered(big, 22, 2);        // y 22..37
  printCentered(line1, 42, 1);      // y 42..49
  printCentered(line2, 54, 1);      // y 54..61
  display.display();
}

// ---------------------------------------------------------------------------
// WiFi + time
// ---------------------------------------------------------------------------
// Runs in the lwIP task whenever an NTP reply has set the system clock.
void onNtpSync(struct timeval *tv) {
  (void)tv;
  ntpFreshReply = true;
}

void startNtp() {
  Serial.println("[ntp] requesting time");
  ntpFreshReply = false;
  configTime(TZ_OFFSET_SEC, 0, "pool.ntp.org", "time.google.com");
  ntpPending = true;
  ntpStartMs = millis();
  lastNtpAttemptMs = ntpStartMs;
}

// After a fresh NTP reply, copy the system clock into the DS3231 as local
// time. Without a reply (within NTP_WAIT_MS) the RTC is left alone.
void updateNtp() {
  uint32_t now = millis();
  if (ntpPending) {
    time_t sys = time(nullptr);
    struct tm local;
    localtime_r(&sys, &local);
    if (ntpFreshReply && local.tm_year + 1900 >= MIN_VALID_YEAR) {
      ntpPending = false;
      ntpEverSynced = true;
      lastNtpSyncMs = now;
      if (rtcOk) {
        rtc.adjust(DateTime(local.tm_year + 1900, local.tm_mon + 1, local.tm_mday,
                            local.tm_hour, local.tm_min, local.tm_sec));
        rtcTimeValid = true;
      }
      Serial.printf("[ntp] synced, RTC set to %04d-%02d-%02d %02d:%02d:%02d (UTC+5:45)\n",
                    local.tm_year + 1900, local.tm_mon + 1, local.tm_mday,
                    local.tm_hour, local.tm_min, local.tm_sec);
    } else if (now - ntpStartMs > NTP_WAIT_MS) {
      ntpPending = false;
      // First sync: retry in NTP_RETRY_MS. Daily re-sync: try again tomorrow.
      if (ntpEverSynced) lastNtpSyncMs = now;
      Serial.println("[ntp] no fresh reply, RTC left unchanged");
    }
    return;
  }
  if (WiFi.status() != WL_CONNECTED) return;
  if (!ntpEverSynced && now - lastNtpAttemptMs > NTP_RETRY_MS) startNtp();
  else if (ntpEverSynced && now - lastNtpSyncMs > NTP_RESYNC_MS) startNtp();
}

void connectWifi() {
  Serial.printf("[wifi] connecting to %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  lastWifiAttemptMs = millis();

  uint8_t dots = 0;
  while (WiFi.status() != WL_CONNECTED && millis() - lastWifiAttemptMs < WIFI_BOOT_WAIT_MS) {
    char progress[22];
    uint8_t n = dots % 11;
    memset(progress, '.', n);
    progress[n] = '\0';
    if (oledOk) {
      display.clearDisplay();
      display.setTextColor(SSD1306_WHITE);
      printCentered("WIFI", 8, 2);
      char ssid[22];
      copyDisplayText(ssid, sizeof(ssid), WIFI_SSID, 21);
      printCentered(ssid, 34, 1);
      printCentered(progress, 48, 1);
      display.display();
    }
    dots++;
    delay(250);  // boot only; the main loop never blocks like this
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] connected, IP %s, RSSI %d dBm\n",
                  WiFi.localIP().toString().c_str(), (int)WiFi.RSSI());
  } else {
    Serial.println("[wifi] not connected yet; will keep retrying in the background");
  }
}

void maintainWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasConnected) {
      wifiWasConnected = true;
      Serial.printf("[wifi] up, IP %s, RSSI %d dBm\n",
                    WiFi.localIP().toString().c_str(), (int)WiFi.RSSI());
      if (!ntpEverSynced && !ntpPending) startNtp();
    }
    return;
  }
  if (wifiWasConnected) {
    wifiWasConnected = false;
    Serial.println("[wifi] lost connection");
  }
  if (millis() - lastWifiAttemptMs > WIFI_RETRY_MS) {
    lastWifiAttemptMs = millis();
    Serial.println("[wifi] reconnecting");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }
}

// ---------------------------------------------------------------------------
// Backend call
// ---------------------------------------------------------------------------
bool serverRecentlyDown() {
  return serverFailStreak > 0 && millis() - serverFailAtMs < SERVER_DOWN_WINDOW_MS;
}

void noteServerFail() {
  if (serverFailStreak < 255) serverFailStreak++;
  serverFailAtMs = millis();
}

void noteServerOk() {
  serverFailStreak = 0;
}

void postCheck(const char *uid, CheckResult &r) {
  memset(&r, 0, sizeof(r));
  r.kind = RES_OFFLINE;

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[http] skipped: no WiFi");
    return;
  }

  StaticJsonDocument<192> req;
  req["uid"] = uid;
  if (rtcOk && rtcTimeValid) req["ts"] = rtcUnixUtc();  // optional server-side
  req["fw"] = FW_VERSION;
  String body;
  serializeJson(req, body);

  // After a failed round trip, fail fast so a dead server does not make every
  // member wait the full timeout at the door.
  uint32_t timeoutMs = serverRecentlyDown() ? HTTP_TIMEOUT_DOWN_MS : HTTP_TIMEOUT_MS;

  WiFiClientSecure client;
  client.setInsecure();  // no certificate check -- see README "Security"
  client.setHandshakeTimeout(timeoutMs / 1000);  // seconds; default is 120

  HTTPClient http;
  http.setConnectTimeout(timeoutMs);
  http.setTimeout(timeoutMs);
  if (!http.begin(client, RFID_ENDPOINT)) {
    Serial.println("[http] begin() failed (bad RFID_ENDPOINT?)");
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);  // never logged

  uint32_t t0 = millis();
  int code = http.POST(body);
  r.httpCode = code;
  String resp = (code > 0) ? http.getString() : String();
  http.end();
  Serial.printf("[http] POST %s -> %d in %lu ms\n", body.c_str(), code,
                (unsigned long)(millis() - t0));
  if (code <= 0) {
    Serial.printf("[http] error: %s\n", HTTPClient::errorToString(code).c_str());
    return;
  }
  Serial.printf("[http] body: %s\n", resp.c_str());

  if (code == 401) { r.kind = RES_KEY_BAD; return; }
  if (code == 403) { r.kind = RES_DISABLED; return; }
  if (code != 200) return;  // 400 / 5xx / anything else: OFFLINE

  DynamicJsonDocument doc(1024);
  DeserializationError err = deserializeJson(doc, resp);
  if (err) {
    Serial.printf("[http] bad JSON: %s\n", err.c_str());
    return;
  }

  const char *decision = doc["decision"] | "";
  if (strcmp(decision, "allow") == 0) r.kind = RES_ALLOW;
  else if (strcmp(decision, "deny") == 0) r.kind = RES_DENY;
  else return;  // unexpected shape: OFFLINE

  copyDisplayText(r.reason, sizeof(r.reason), doc["reason"] | "", sizeof(r.reason) - 1);
  copyDisplayText(r.name, sizeof(r.name), doc["member_name"] | "", NAME_MAX_CHARS);
  copyDisplayText(r.code, sizeof(r.code), doc["member_code"] | "", sizeof(r.code) - 1);
  copyDisplayText(r.status, sizeof(r.status), doc["status"] | "", sizeof(r.status) - 1);
  r.hasDays = !doc["days_to_expiry"].isNull();
  r.days = doc["days_to_expiry"] | 0L;
  r.duePaisa = doc["due_paisa"] | 0L;
  r.alreadyIn = doc["already_checked_in_today"] | false;
}

// ---------------------------------------------------------------------------
// Offline mode: allow-list cache, tap queue, sync
// ---------------------------------------------------------------------------
// Org-local YYYYMMDD from the RTC (which holds local time); 0 if the clock
// cannot be trusted.
uint32_t todayYmd() {
  if (!rtcOk || !rtcTimeValid) return 0;
  DateTime t = rtc.now();
  return (uint32_t)t.year() * 10000UL + (uint32_t)t.month() * 100UL + (uint32_t)t.day();
}

void loadMeta() {
  cardsCached = 0;
  cacheSyncDay = 0;
  if (!fsOk) return;
  File f = LittleFS.open(META_FILE, "r");
  if (!f) return;
  CacheMeta m;
  if (f.read((uint8_t *)&m, sizeof(m)) == sizeof(m) && m.magic == META_MAGIC) {
    cardsCached = m.count;
    cacheSyncDay = m.syncDay;
  }
  f.close();
}

void saveMeta(uint32_t syncDay, uint32_t count) {
  File f = LittleFS.open(META_FILE, "w");
  if (!f) return;
  CacheMeta m = { META_MAGIC, syncDay, count };
  f.write((const uint8_t *)&m, sizeof(m));
  f.close();
  cardsCached = count;
  cacheSyncDay = syncDay;
}

uint32_t countEvents() {
  if (!fsOk) return 0;
  File f = LittleFS.open(EVENTS_FILE, "r");
  if (!f) return 0;
  uint32_t n = (uint32_t)(f.size() / sizeof(EventRec));
  f.close();
  return n;
}

// Days since 1970-01-01 for a YYYYMMDD date (civil-from-days, Howard Hinnant).
long ymdToDays(uint32_t ymd) {
  long y = (long)(ymd / 10000UL);
  long m = (long)((ymd / 100UL) % 100UL);
  long d = (long)(ymd % 100UL);
  y -= m <= 2;
  long era = (y >= 0 ? y : y - 399) / 400;
  long yoe = y - era * 400;
  long doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + doe - 719468;
}

// "30 Days Left", "1 Day Left", "Expires Today"; blank when there is no date.
void formatDaysLeft(char *out, size_t outSize, long days) {
  if (days < 0) snprintf(out, outSize, "Expired");
  else if (days == 0) snprintf(out, outSize, "Expires Today");
  else if (days == 1) snprintf(out, outSize, "1 Day Left");
  else snprintf(out, outSize, "%ld Days Left", days);
}

// What does the cached list say about this card? For an allowed card `days`
// is the whole days left (0 = last day). With the clock unset, "today" is the
// day of the last sync -- the date the server last vouched for -- not a guess.
CacheVerdict cacheLookup(const char *uid, uint32_t &until, long &days) {
  until = 0;
  days = 0;
  if (!fsOk || cacheSyncDay == 0) return CV_NO_CACHE;
  File f = LittleFS.open(CARDS_FILE, "r");
  if (!f) return CV_NO_CACHE;

  uint32_t today = todayYmd();
  if (today == 0) {
    today = cacheSyncDay;
    Serial.println("[cache] clock not set: judging against the last sync day");
  }

  char want[UID_HEX_MAX];
  memset(want, 0, sizeof(want));
  strncpy(want, uid, UID_HEX_MAX);

  CardRec buf[16];
  for (;;) {
    size_t n = f.read((uint8_t *)buf, sizeof(buf)) / sizeof(CardRec);
    if (n == 0) break;
    for (size_t i = 0; i < n; i++) {
      if (memcmp(buf[i].uid, want, UID_HEX_MAX) != 0) continue;
      f.close();
      switch (buf[i].st) {
        case 'A':
          until = buf[i].until;
          days = ymdToDays(until) - ymdToDays(today);
          return days >= 0 ? CV_ALLOW : CV_EXPIRED;
        case 'D': return CV_DUES;
        case 'F': return CV_FROZEN;
        case 'U': return CV_UPCOMING;
        case 'N': return CV_NONE;
        case 'L': return CV_LEFT;
        default:  return CV_EXPIRED;  // 'E' and anything unforeseen
      }
    }
  }
  f.close();
  return CV_UNKNOWN;
}

// Queue an offline entry for upload. One per card per day: a member tapping
// five times while the network is down is one visit.
bool enqueueEvent(const char *uid) {
  if (!fsOk) return false;
  EventRec e;
  memset(&e, 0, sizeof(e));
  strncpy(e.uid, uid, UID_HEX_MAX);
  e.ts = (rtcOk && rtcTimeValid) ? rtcUnixUtc() : 0;

  uint32_t n = 0;
  File f = LittleFS.open(EVENTS_FILE, "r");
  if (f) {
    n = (uint32_t)(f.size() / sizeof(EventRec));
    if (e.ts != 0) {
      uint32_t day = (e.ts + (uint32_t)TZ_OFFSET_SEC) / 86400UL;
      EventRec buf[16];
      for (;;) {
        size_t got = f.read((uint8_t *)buf, sizeof(buf)) / sizeof(EventRec);
        if (got == 0) break;
        for (size_t i = 0; i < got; i++) {
          if (buf[i].ts != 0 && memcmp(buf[i].uid, e.uid, UID_HEX_MAX) == 0 &&
              (buf[i].ts + (uint32_t)TZ_OFFSET_SEC) / 86400UL == day) {
            f.close();
            return true;  // already queued for today
          }
        }
      }
    }
    f.close();
  }
  if (n >= EVENTS_MAX) {
    Serial.println("[queue] full: tap not queued");
    return false;
  }
  File a = LittleFS.open(EVENTS_FILE, "a");
  if (!a) return false;
  a.write((const uint8_t *)&e, sizeof(e));
  a.close();
  eventsQueued = n + 1;
  Serial.printf("[queue] %lu tap(s) waiting to upload\n", (unsigned long)eventsQueued);
  return true;
}

// Forget the cached list. After this the reader falls back to "OFFLINE, NOT
// RECORDED" instead of opening the door for cards the server may no longer vouch
// for (reader disabled, key rotated).
void invalidateCache(const char *why) {
  Serial.printf("[cache] invalidated: %s\n", why);
  if (fsOk) {
    LittleFS.remove(CARDS_FILE);
    LittleFS.remove(META_FILE);
  }
  cardsCached = 0;
  cacheSyncDay = 0;
  syncEverDone = false;
}

// The server did not answer. Decide from the cached list instead. The screen
// then says the same things it would online (EXPIRED, FROZEN, UNKNOWN CARD,
// N Days Left) minus what only the server knows: the member's name and the
// amount owed.
void applyOfflineFallback(const char *uid, CheckResult &r) {
  uint32_t until = 0;
  long days = 0;
  CacheVerdict v = cacheLookup(uid, until, days);
  if (v == CV_NO_CACHE) return;  // never synced: stays RES_OFFLINE, "NOT RECORDED"

  copyDisplayText(r.name, sizeof(r.name), uid, NAME_MAX_CHARS);
  const char *reason = "expired";
  switch (v) {
    case CV_ALLOW:
      r.kind = RES_OFFLINE_ALLOW;
      r.until = until;
      r.hasDays = until < 20991231UL;  // 2099-12-31 stands for "no end date"
      r.days = days;
      r.notLogged = !enqueueEvent(uid);
      return;
    case CV_FROZEN:   reason = "frozen"; break;
    case CV_UPCOMING: reason = "upcoming"; break;
    case CV_NONE:     reason = "none"; break;
    case CV_LEFT:     reason = "left"; break;
    case CV_DUES:     reason = "dues"; break;
    case CV_UNKNOWN:  reason = "unknown_card"; break;
    default:          reason = "expired"; break;
  }
  // A denied tap is not queued -- denied taps write nothing, online or off.
  r.kind = RES_DENY;
  copyDisplayText(r.reason, sizeof(r.reason), reason, sizeof(r.reason) - 1);
}

void abortSyncFor(const char *why, uint32_t retryMs) {
  Serial.printf("[sync] aborted: %s\n", why);
  if (syncFile) syncFile.close();
  LittleFS.remove(CARDS_TMP_FILE);
  syncActive = false;
  syncBackoffOn = true;
  syncBackoffUntilMs = millis() + retryMs;
  syncDue = true;
}

void abortSync(const char *why) {
  abortSyncFor(why, SYNC_RETRY_MS);
}

// Fetch ONE page of the allow-list per call, so a tap never waits behind more
// than one page. Pages stream into /cards.new; on the last page it replaces
// /cards.bin, so a power cut or a bad page never leaves half a list in use.
// Returns true if it used the network this call.
bool syncStep() {
  if (!fsOk || WiFi.status() != WL_CONNECTED || serverRecentlyDown()) return false;
  uint32_t now = millis();

  if (!syncActive) {
    if (syncEverDone && now - lastSyncOkMs >= SYNC_INTERVAL_MS) syncDue = true;
    if (syncBackoffOn) {
      if ((int32_t)(now - syncBackoffUntilMs) < 0) return false;
      syncBackoffOn = false;
    }
    if (!syncDue) return false;
    LittleFS.remove(CARDS_TMP_FILE);
    syncFile = LittleFS.open(CARDS_TMP_FILE, "w");
    if (!syncFile) { abortSync("cannot open temp file"); return false; }
    syncAfter[0] = '\0';
    syncPages = 0;
    syncCount = 0;
    syncActive = true;
    Serial.println("[sync] starting");
  }

  String url = String(RFID_SYNC_ENDPOINT) + "?limit=" + String(SYNC_PAGE_LIMIT);
  if (syncAfter[0] != '\0') url += String("&after=") + syncAfter;

  WiFiClientSecure client;
  client.setInsecure();  // see README "Security"
  client.setHandshakeTimeout(BG_TIMEOUT_MS / 1000);
  HTTPClient http;
  http.setConnectTimeout(BG_TIMEOUT_MS);
  http.setTimeout(BG_TIMEOUT_MS);
  if (!http.begin(client, url)) { abortSync("begin() failed"); return true; }
  http.addHeader("x-device-key", DEVICE_KEY);  // never logged

  int code = http.GET();
  if (code != 200) {
    http.end();
    char why[32];
    snprintf(why, sizeof(why), "HTTP %d", code);
    if (code == 401 || code == 403) {
      invalidateCache(why);  // unknown or disabled reader: stop trusting the old list
      abortSyncFor(why, SYNC_RETRY_BADKEY_MS);
    } else {
      noteServerFail();
      abortSync(why);
    }
    return true;
  }
  noteServerOk();
  String body = http.getString();
  http.end();
  bool writeFailed = false;

  bool sawEnd = false;
  bool sawMore = false;
  uint32_t orgToday = 0;
  char moreUid[UID_HEX_MAX + 1] = "";

  const char *p = body.c_str();
  while (*p) {
    const char *eol = strchr(p, '\n');
    size_t len = eol ? (size_t)(eol - p) : strlen(p);
    char line[64];
    size_t take = len < sizeof(line) - 1 ? len : sizeof(line) - 1;
    memcpy(line, p, take);
    line[take] = '\0';
    while (take > 0 && (line[take - 1] == '\r' || line[take - 1] == ' ')) line[--take] = '\0';
    p += len + (eol ? 1 : 0);
    if (take == 0) continue;

    if (line[0] == '#') {
      if (strncmp(line, "#END,", 5) == 0) {
        sawEnd = true;
        orgToday = (uint32_t)strtoul(line + 5, nullptr, 10);
      } else if (strncmp(line, "#MORE,", 6) == 0) {
        char *comma = strchr(line + 6, ',');
        if (comma && comma - (line + 6) <= UID_HEX_MAX) {
          sawMore = true;
          memcpy(moreUid, line + 6, (size_t)(comma - (line + 6)));
          moreUid[comma - (line + 6)] = '\0';
          orgToday = (uint32_t)strtoul(comma + 1, nullptr, 10);
        }
      }
      continue;
    }

    char *comma = strchr(line, ',');
    if (!comma) continue;
    size_t uidLen = (size_t)(comma - line);
    if (uidLen < 8 || uidLen > UID_HEX_MAX) continue;
    // "UID,YYYYMMDD,C": C = status code (see CardRec). Unknown codes are kept
    // and treated as expired, so a newer server never opens the door by accident.
    char *comma2 = strchr(comma + 1, ',');
    if (!comma2 || comma2[1] == '\0') continue;
    CardRec rec;
    memset(&rec, 0, sizeof(rec));
    memcpy(rec.uid, line, uidLen);
    rec.until = (uint32_t)strtoul(comma + 1, nullptr, 10);
    rec.st = comma2[1];
    if (rec.st == 'A' && rec.until < 20240101UL) continue;
    if (syncFile.write((const uint8_t *)&rec, sizeof(rec)) != sizeof(rec)) writeFailed = true;
    syncCount++;
  }

  if (writeFailed) {
    abortSync("flash write failed");
    return true;
  }

  if (sawMore && moreUid[0] != '\0' && strcmp(moreUid, syncAfter) != 0) {
    strncpy(syncAfter, moreUid, UID_HEX_MAX);
    syncAfter[UID_HEX_MAX] = '\0';
    syncPages++;
    return true;  // next page on the next call
  }
  if (!sawEnd || orgToday < 20240101UL) {
    abortSync("response not terminated");
    return true;
  }

  syncFile.close();
  // The temp file must hold exactly what we counted, or it is a truncated list.
  File chk = LittleFS.open(CARDS_TMP_FILE, "r");
  bool intact = chk && chk.size() == (size_t)syncCount * sizeof(CardRec);
  if (chk) chk.close();
  if (!intact) {
    abortSync("temp list incomplete");
    return true;
  }
  // Replace in one rename so the old list survives a failure; only if the
  // filesystem refuses to overwrite do we fall back to remove-then-rename.
  if (!LittleFS.rename(CARDS_TMP_FILE, CARDS_FILE)) {
    LittleFS.remove(CARDS_FILE);
    if (!LittleFS.rename(CARDS_TMP_FILE, CARDS_FILE)) {
      abortSync("rename failed");
      return true;
    }
  }
  saveMeta(orgToday, syncCount);
  syncActive = false;
  syncEverDone = true;
  syncDue = false;
  lastSyncOkMs = millis();
  Serial.printf("[sync] done: %lu cards in %lu page(s), org day %lu\n",
                (unsigned long)syncCount, (unsigned long)(syncPages + 1),
                (unsigned long)orgToday);
  return true;
}

// Upload queued offline taps, one batch per call. Records leave the queue only
// after a 200; the server is idempotent per member per day, so a retry after a
// lost reply is safe.
bool uploadStep() {
  if (!fsOk || eventsQueued == 0 || WiFi.status() != WL_CONNECTED || serverRecentlyDown()) return false;
  uint32_t now = millis();
  if (lastUploadAttemptMs != 0 && now - lastUploadAttemptMs < uploadRetryMs) return false;
  lastUploadAttemptMs = now;

  File f = LittleFS.open(EVENTS_FILE, "r");
  if (!f) { eventsQueued = 0; return false; }
  uint32_t total = (uint32_t)(f.size() / sizeof(EventRec));
  if (total == 0) { f.close(); LittleFS.remove(EVENTS_FILE); eventsQueued = 0; return false; }
  uint32_t take = total < UPLOAD_BATCH ? total : UPLOAD_BATCH;

  String body = "{\"events\":[";
  for (uint32_t i = 0; i < take; i++) {
    EventRec e;
    if (f.read((uint8_t *)&e, sizeof(e)) != sizeof(e)) { take = i; break; }
    char uid[UID_HEX_MAX + 1];
    memcpy(uid, e.uid, UID_HEX_MAX);
    uid[UID_HEX_MAX] = '\0';
    if (i > 0) body += ',';
    body += "{\"uid\":\"";
    body += uid;
    body += '"';
    if (e.ts != 0) { body += ",\"ts\":"; body += String(e.ts); }
    body += '}';
  }
  body += "]}";
  if (take == 0) { f.close(); return false; }

  WiFiClientSecure client;
  client.setInsecure();
  client.setHandshakeTimeout(BG_TIMEOUT_MS / 1000);
  HTTPClient http;
  http.setConnectTimeout(BG_TIMEOUT_MS);
  http.setTimeout(BG_TIMEOUT_MS);
  if (!http.begin(client, RFID_SYNC_ENDPOINT)) { f.close(); return true; }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);  // never logged
  int code = http.POST(body);
  String resp = (code > 0) ? http.getString() : String();
  http.end();
  Serial.printf("[upload] %lu tap(s) -> HTTP %d %s\n", (unsigned long)take, code, resp.c_str());

  if (code == 401 || code == 403) {
    // Unknown or disabled reader: the queue cannot upload, and the cached list
    // must stop opening the door. Keep the queue; retry slowly.
    f.close();
    uploadRetryMs = UPLOAD_RETRY_BADKEY_MS;
    invalidateCache("upload refused");
    return true;
  }
  if (code != 200) {
    f.close();
    noteServerFail();
    uploadRetryMs = UPLOAD_RETRY_MS;
    return true;
  }
  noteServerOk();
  uploadRetryMs = UPLOAD_RETRY_MS;

  // Keep whatever was not in this batch.
  uint32_t remaining = total - take;
  if (remaining == 0) {
    f.close();
    LittleFS.remove(EVENTS_FILE);
  } else {
    File out = LittleFS.open(EVENTS_TMP_FILE, "w");
    if (!out) { f.close(); return true; }  // stays queued; duplicates are harmless
    EventRec buf[16];
    for (;;) {
      size_t got = f.read((uint8_t *)buf, sizeof(buf)) / sizeof(EventRec);
      if (got == 0) break;
      out.write((const uint8_t *)buf, got * sizeof(EventRec));
    }
    out.close();
    f.close();
    LittleFS.remove(EVENTS_FILE);
    LittleFS.rename(EVENTS_TMP_FILE, EVENTS_FILE);
    lastUploadAttemptMs = 0;  // more to send: next batch right away
  }
  eventsQueued = remaining;
  return true;
}

// ---------------------------------------------------------------------------
// Card + buttons
// ---------------------------------------------------------------------------
void enterState(ReaderState s) {
  // The same-UID window runs from the end of the result hold, so a card left
  // on the reader is not posted again the moment the screen clears.
  if (s == ST_IDLE && state == ST_RESULT) lastUidMs = millis();
  state = s;
  stateSinceMs = millis();
  if (s == ST_IDLE) {
    lastIdleDrawMs = millis();
    drawIdle();
  }
}

// Pick the rhythm for what the screen is about to say (see the table at the
// beep patterns). Expiring = 7 days or fewer left, the same line the server's
// banner draws between "active" and "expiring".
void beepForResult(const CheckResult &r) {
  switch (r.kind) {
    case RES_ALLOW:
      if (r.hasDays && r.days <= 7) startBeep(BEEP_DOUBLE, PATTERN_LEN(BEEP_DOUBLE));
      else startBeep(BEEP_SHORT, PATTERN_LEN(BEEP_SHORT));
      break;
    case RES_OFFLINE_ALLOW:
      startBeep(BEEP_OFFLINE, PATTERN_LEN(BEEP_OFFLINE));
      break;
    case RES_DENY:
      if (strcmp(r.reason, "unknown_card") == 0 || strcmp(r.reason, "bad_uid") == 0) {
        startBeep(BEEP_TRIPLE, PATTERN_LEN(BEEP_TRIPLE));
      } else if (strcmp(r.reason, "dues") == 0) {
        startBeep(BEEP_DUES, PATTERN_LEN(BEEP_DUES));
      } else {
        startBeep(BEEP_LONG, PATTERN_LEN(BEEP_LONG));
      }
      break;
    default:
      startBeep(BEEP_LONG, PATTERN_LEN(BEEP_LONG));
      break;
  }
}

void handleCard() {
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;

  char uid[21];
  readUidHex(uid, sizeof(uid));
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  uint32_t now = millis();
  if (strcmp(uid, lastUid) == 0 && now - lastUidMs < SAME_UID_DEBOUNCE_MS) {
    lastUidMs = now;  // still on the reader: keep suppressing
    return;
  }
  strncpy(lastUid, uid, sizeof(lastUid) - 1);
  lastUid[sizeof(lastUid) - 1] = '\0';

  Serial.printf("[card] UID %s\n", uid);
  showMessage("CHECKING", uid, "");

  CheckResult r;
  if (testOffline) {
    memset(&r, 0, sizeof(r));  // menu "Offline test": pretend the server is unreachable
    r.kind = RES_OFFLINE;
  } else {
    postCheck(uid, r);  // blocks for up to ~HTTP_TIMEOUT_MS (the only blocking call)
  }
  if (r.kind == RES_OFFLINE) {
    if (!testOffline && WiFi.status() == WL_CONNECTED) noteServerFail();  // server trouble, not just no WiFi
    applyOfflineFallback(uid, r);  // may turn it into an offline allow / deny
  } else {
    noteServerOk();
    // The server answered and refused THIS READER: its cached list must not
    // keep opening the door the next time the network drops.
    if (r.kind == RES_KEY_BAD || r.kind == RES_DISABLED) invalidateCache("reader refused by server");
  }
  lastUidMs = millis();

  logTap(uid, r);

  // Open the door as soon as the decision is known, before the OLED redraw.
  if ((r.kind == RES_ALLOW || r.kind == RES_OFFLINE_ALLOW) && settings.relayOn) {
    relayOpen(settings.openMs);
  }

  drawResult(r);
  beepForResult(r);
  state = ST_RESULT;
  stateSinceMs = millis();
}

// ---------------------------------------------------------------------------
// Relay
// ---------------------------------------------------------------------------
void relayWrite(bool energised) {
  digitalWrite(RELAY_PIN, (energised == (RELAY_ACTIVE_HIGH != 0)) ? HIGH : LOW);
}

// Energise the relay for `ms` (extends an open pulse). Released by updateRelay().
void relayOpen(uint16_t ms) {
  relayWrite(true);
  relayActive = true;
  relayUntilMs = millis() + ms;
  Serial.printf("[relay] open for %u ms\n", (unsigned)ms);
}

void updateRelay() {
  if (relayActive && (int32_t)(millis() - relayUntilMs) >= 0) {
    relayWrite(false);
    relayActive = false;
    Serial.println("[relay] closed");
  }
}

// ---------------------------------------------------------------------------
// Settings (persisted) and keypad
// ---------------------------------------------------------------------------
void loadSettings() {
  if (!fsOk) return;
  File f = LittleFS.open(SETTINGS_FILE, "r");
  if (!f) return;
  Settings t;
  if (f.read((uint8_t *)&t, sizeof(t)) == sizeof(t) && t.magic == SETTINGS_MAGIC &&
      t.openMs >= 200 && t.openMs <= 30000) {
    settings = t;
  }
  f.close();
}

void saveSettings() {
  if (!fsOk) return;
  File f = LittleFS.open(SETTINGS_FILE, "w");
  if (!f) return;
  f.write((const uint8_t *)&settings, sizeof(settings));
  f.close();
}

// Debounced scan of K1..K4 (active-low). Returns a bitmask of keys that went
// down since the last call (bit 0 = K1). Also sets k4LongFired once when K4 has
// been held for MENU_LONG_PRESS_MS.
uint8_t pollButtons() {
  uint8_t pressed = 0;
  uint32_t now = millis();
  for (uint8_t i = 0; i < 4; i++) {
    if (BTN_PINS[i] < 0) continue;
    bool down = digitalRead(BTN_PINS[i]) == LOW;
    if (down != btnDown[i] && now - btnChangeMs[i] > BTN_DEBOUNCE_MS) {
      btnChangeMs[i] = now;
      btnDown[i] = down;
      if (down) {
        pressed |= (uint8_t)(1u << i);
        btnDownSinceMs[i] = now;
      }
    }
  }
  if (btnDown[3] && !k4LongFired && now - btnDownSinceMs[3] >= MENU_LONG_PRESS_MS) {
    k4LongFired = true;
  }
  if (!btnDown[3]) k4LongFired = false;
  return pressed;
}

// ---------------------------------------------------------------------------
// Settings menu (hold K4, enter the code; K1 up, K2 down, K3 change, K4 back)
// ---------------------------------------------------------------------------
void menuValue(uint8_t item, char *out, size_t outSize) {
  switch (item) {
    case MI_OFFLINE_TEST: snprintf(out, outSize, "%s", testOffline ? "ON" : "OFF"); break;
    case MI_RELAY:        snprintf(out, outSize, "%s", settings.relayOn ? "ON" : "OFF"); break;
    case MI_OPEN_TIME:    snprintf(out, outSize, "%us", (unsigned)(settings.openMs / 1000)); break;
    case MI_SOUND:        snprintf(out, outSize, "%s", settings.soundOn ? "ON" : "OFF"); break;
    case MI_RELAY_TEST:
    case MI_SOUND_TEST:
    case MI_SYNC_NOW:     snprintf(out, outSize, "go"); break;
    default:              out[0] = '\0'; break;
  }
}

void drawMenu() {
  static const char *const LABELS[MI_COUNT] = {
    "Offline test", "Relay", "Open time", "Relay test", "Sound", "Sound test", "Sync now", "Back"
  };
  if (!oledOk) return;
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.print("SETTINGS");

  const uint8_t rows = 5;
  uint8_t first = 0;
  if (menuIdx >= 2) first = menuIdx - 2;
  if (first > MI_COUNT - rows) first = MI_COUNT - rows;
  for (uint8_t r = 0; r < rows; r++) {
    uint8_t idx = first + r;
    int16_t y = 12 + r * 10;
    bool sel = idx == menuIdx;
    if (sel) {
      display.fillRect(0, y - 1, OLED_W, 10, SSD1306_WHITE);
      display.setTextColor(SSD1306_BLACK);
    } else {
      display.setTextColor(SSD1306_WHITE);
    }
    display.setCursor(3, y);
    display.print(LABELS[idx]);
    char val[8];
    menuValue(idx, val, sizeof(val));
    display.setCursor(OLED_W - 3 - (int16_t)strlen(val) * 6, y);
    display.print(val);
  }
  display.setTextColor(SSD1306_WHITE);
  display.display();
}

void enterMenu() {
  menuIdx = 0;
  menuLastKeyMs = millis();
  state = ST_MENU;
  stateSinceMs = millis();
  drawMenu();
}

void drawPin() {
  char stars[9];
  uint8_t n = (uint8_t)strlen(pinEntered);
  memset(stars, '*', n);
  stars[n] = '\0';
  showMessage("PIN", stars, "press K1-K4");
}

// Hold K4 on the idle screen: ask for the code (or go straight in if none is set).
void startSettings() {
  Serial.println("[menu] settings requested");
  if (strlen(SETTINGS_PIN) == 0) { enterMenu(); return; }
  pinEntered[0] = '\0';
  state = ST_PIN;
  stateSinceMs = millis();
  menuLastKeyMs = millis();
  drawPin();
}

void menuAction(uint8_t item) {
  switch (item) {
    case MI_OFFLINE_TEST:
      testOffline = !testOffline;
      Serial.printf("[menu] offline test %s\n", testOffline ? "ON" : "OFF");
      if (!testOffline) lastUploadAttemptMs = 0;  // queued taps may go up now
      break;
    case MI_RELAY:
      settings.relayOn = !settings.relayOn;
      saveSettings();
      break;
    case MI_OPEN_TIME: {
      static const uint16_t CHOICES[] = { 1000, 3000, 5000, 10000 };
      uint8_t next = 0;
      for (uint8_t i = 0; i < 4; i++) if (settings.openMs == CHOICES[i]) next = (i + 1) % 4;
      settings.openMs = CHOICES[next];
      saveSettings();
      break;
    }
    case MI_RELAY_TEST:
      relayOpen(settings.openMs);  // works even with Relay OFF: it is a wiring check
      break;
    case MI_SOUND:
      settings.soundOn = !settings.soundOn;
      saveSettings();
      if (settings.soundOn) startBeep(BEEP_SHORT, PATTERN_LEN(BEEP_SHORT));
      break;
    case MI_SOUND_TEST:
      startBeepAlways(BEEP_TEST, PATTERN_LEN(BEEP_TEST));  // a wiring check: ignores Sound OFF
      break;
    case MI_SYNC_NOW:
      syncDue = true;
      syncBackoffOn = false;
      startBeep(BEEP_SHORT, PATTERN_LEN(BEEP_SHORT));
      break;
    default:
      break;
  }
}

void handleMenuKeys(uint8_t keys) {
  if (keys == 0) return;
  menuLastKeyMs = millis();
  if (keys & 0x01) menuIdx = (menuIdx + MI_COUNT - 1) % MI_COUNT;  // K1 up
  if (keys & 0x02) menuIdx = (menuIdx + 1) % MI_COUNT;             // K2 down
  if (keys & 0x04) {                                               // K3 change / run
    if (menuIdx == MI_BACK) { enterState(ST_IDLE); return; }
    menuAction(menuIdx);
  }
  if (keys & 0x08) { enterState(ST_IDLE); return; }                // K4 back
  drawMenu();
}

void handlePinKeys(uint8_t keys) {
  if (keys == 0) return;
  menuLastKeyMs = millis();
  size_t want = strlen(SETTINGS_PIN);
  for (uint8_t i = 0; i < 4; i++) {
    if (!(keys & (1u << i))) continue;
    size_t n = strlen(pinEntered);
    if (n < sizeof(pinEntered) - 1) {
      pinEntered[n] = (char)('1' + i);
      pinEntered[n + 1] = '\0';
    }
    break;  // one key per pass
  }
  if (strlen(pinEntered) < want) { drawPin(); return; }
  if (strcmp(pinEntered, SETTINGS_PIN) == 0) {
    Serial.println("[menu] code accepted");
    enterMenu();
  } else {
    Serial.println("[menu] wrong code");
    showMessage("WRONG", "PIN", "");
    startBeep(BEEP_LONG, PATTERN_LEN(BEEP_LONG));
    delay(1200);
    enterState(ST_IDLE);
  }
}

// USB serial shortcuts, handy at the bench and when the keypad is not wired:
//   o = toggle offline test, r = relay test, b = sound test, s = sync now, i = status
void serialCommands() {
  while (Serial.available() > 0) {
    int c = Serial.read();
    if (c == 'o') {
      menuAction(MI_OFFLINE_TEST);
    } else if (c == 'r') {
      menuAction(MI_RELAY_TEST);
    } else if (c == 'b') {
      menuAction(MI_SOUND_TEST);
    } else if (c == 's') {
      menuAction(MI_SYNC_NOW);
    } else if (c == 'i') {
      Serial.printf("[status] fw %s offlineTest=%d relay=%d open=%ums sound=%d cache=%lu queue=%lu wifi=%d\n",
                    FW_VERSION, testOffline, settings.relayOn, (unsigned)settings.openMs,
                    settings.soundOn, (unsigned long)cardsCached, (unsigned long)eventsQueued,
                    WiFi.status() == WL_CONNECTED);
    }
  }
}

// ---------------------------------------------------------------------------
// WiFi settings page (plain HTTP on the LAN; password + per-page token)
// ---------------------------------------------------------------------------
// Deliberately NOT here: anything that opens the door. Relay test stays on the
// keypad and USB serial.
void logTap(const char *uid, const CheckResult &r) {
  TapLog &t = tapLog[tapLogHead];
  t.localSecs = (rtcOk && rtcTimeValid) ? rtcUnixUtc() + (uint32_t)TZ_OFFSET_SEC : 0;
  size_t n = strlen(uid);
  strncpy(t.tail, uid + (n > 4 ? n - 4 : 0), sizeof(t.tail) - 1);
  t.tail[sizeof(t.tail) - 1] = '\0';
  switch (r.kind) {
    case RES_ALLOW:         snprintf(t.what, sizeof(t.what), "%s", r.alreadyIn ? "ALREADY IN" : "ALLOW"); break;
    case RES_OFFLINE_ALLOW: snprintf(t.what, sizeof(t.what), "OFFLINE ALLOW"); break;
    case RES_DENY:          snprintf(t.what, sizeof(t.what), "DENY %.9s", r.reason); break;
    case RES_KEY_BAD:       snprintf(t.what, sizeof(t.what), "KEY UNKNOWN"); break;
    case RES_DISABLED:      snprintf(t.what, sizeof(t.what), "READER DISABLED"); break;
    default:                snprintf(t.what, sizeof(t.what), "NO REPLY"); break;
  }
  tapLogHead = (tapLogHead + 1) % TAP_LOG_N;
  if (tapLogCount < TAP_LOG_N) tapLogCount++;
}

void newWebToken() {
  snprintf(webToken, sizeof(webToken), "%08lx%08lx", (unsigned long)esp_random(),
           (unsigned long)esp_random());
}

// HTTP Basic, with a lockout after WEB_MAX_FAILS wrong passwords.
bool webAuthOk() {
  uint32_t now = millis();
  if (webLockOn) {
    if ((int32_t)(now - webLockUntilMs) < 0) {
      web.send(429, "text/plain", "Too many wrong passwords. Wait a minute.");
      return false;
    }
    webLockOn = false;  // expired: clear it, or the signed compare flips after ~25 days
  }
  if (!web.authenticate(WEB_USER, WEB_PASSWORD)) {
    // A browser's first request carries no credentials; only count real attempts.
    if (web.hasHeader("Authorization")) {
      if (++webFails >= WEB_MAX_FAILS) {
        webFails = 0;
        webLockOn = true;
        webLockUntilMs = now + WEB_LOCKOUT_MS;
        Serial.println("[web] too many wrong passwords: locked for 60 s");
      }
    }
    web.requestAuthentication(BASIC_AUTH, "RFID reader");
    return false;
  }
  webFails = 0;
  return true;
}

String fmtUptime() {
  uint32_t s = millis() / 1000UL;
  char b[24];
  snprintf(b, sizeof(b), "%lud %02lu:%02lu:%02lu", (unsigned long)(s / 86400UL),
           (unsigned long)((s / 3600UL) % 24UL), (unsigned long)((s / 60UL) % 60UL),
           (unsigned long)(s % 60UL));
  return String(b);
}

String fmtLocalTime(uint32_t localSecs) {
  if (localSecs == 0) return String("--:--:--");
  uint32_t d = localSecs % 86400UL;
  char b[12];
  snprintf(b, sizeof(b), "%02lu:%02lu:%02lu", (unsigned long)(d / 3600UL),
           (unsigned long)((d / 60UL) % 60UL), (unsigned long)(d % 60UL));
  return String(b);
}

String fmtYmd(uint32_t ymd) {
  if (ymd == 0) return String("never");
  char b[12];
  snprintf(b, sizeof(b), "%04lu-%02lu-%02lu", (unsigned long)(ymd / 10000UL),
           (unsigned long)((ymd / 100UL) % 100UL), (unsigned long)(ymd % 100UL));
  return String(b);
}

void htmlToggleRow(String &h, const char *label, const char *field, bool on, const char *hint) {
  h += "<div class=row><div>";
  h += label;
  h += " <b>";
  h += on ? "ON" : "OFF";
  h += "</b>";
  if (hint[0]) { h += "<br><small>"; h += hint; h += "</small>"; }
  h += "</div><form method=post action=/set><input type=hidden name=t value=";
  h += webToken;
  h += "><button name=";
  h += field;
  h += " value=on";
  if (on) h += " class=on";
  h += ">ON</button> <button name=";
  h += field;
  h += " value=off";
  if (!on) h += " class=on";
  h += ">OFF</button></form></div>";
}

void webRoot() {
  if (!webAuthOk()) return;
  newWebToken();

  char clock[24];
  formatRtc(clock, sizeof(clock), true);
  String h;
  h.reserve(5000);
  h += F("<!doctype html><html><head><meta charset=utf-8>"
         "<meta name=viewport content='width=device-width,initial-scale=1'>"
         "<title>RFID reader</title><style>"
         "body{font:15px system-ui,sans-serif;margin:0 auto;padding:16px;max-width:560px;background:#111;color:#eee}"
         "h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;margin:22px 0 6px;color:#9ab;text-transform:uppercase}"
         "table{width:100%;border-collapse:collapse}td{padding:5px 0;border-bottom:1px solid #333}"
         "td:last-child{text-align:right}.row{display:flex;gap:10px;align-items:center;justify-content:space-between;"
         "padding:9px 0;border-bottom:1px solid #333}form{margin:0;white-space:nowrap}"
         "button{font:inherit;padding:8px 12px;border-radius:8px;border:1px solid #567;background:#234;color:#eee}"
         "button.on{background:#2a6;border-color:#2a6}small{color:#9ab}.warn{color:#fb4}"
         "</style></head><body>");
  h += "<h1>";
  h += DEVICE_LABEL;
  h += "</h1><small>fw ";
  h += FW_VERSION;
  h += "</small>";
  if (testOffline) h += "<p class=warn>OFFLINE TEST is on: taps are decided from the cached list and queued.</p>";

  h += "<h2>Status</h2><table>";
  h += "<tr><td>Reader clock</td><td>"; h += clock; h += "</td></tr>";
  h += "<tr><td>WiFi</td><td>"; h += WiFi.localIP().toString(); h += " &middot; "; h += String((int)WiFi.RSSI()); h += " dBm</td></tr>";
  h += "<tr><td>Uptime</td><td>"; h += fmtUptime(); h += "</td></tr>";
  h += "<tr><td>Cards cached</td><td>"; h += String((unsigned long)cardsCached); h += "</td></tr>";
  h += "<tr><td>Last sync (org day)</td><td>"; h += fmtYmd(cacheSyncDay); h += "</td></tr>";
  h += "<tr><td>Taps waiting to upload</td><td>"; h += String((unsigned long)eventsQueued); h += "</td></tr>";
  h += "</table>";

  h += "<h2>Settings</h2>";
  htmlToggleRow(h, "Offline test", "offline_test", testOffline, "skip the server, use the cached list; taps queue until switched off");
  htmlToggleRow(h, "Door relay", "relay", settings.relayOn, "OFF = allowed taps no longer open the door");
  htmlToggleRow(h, "Sound", "sound", settings.soundOn, "");

  h += "<div class=row><div>Open time <b>";
  h += String((unsigned)(settings.openMs / 1000));
  h += " s</b></div><form method=post action=/set><input type=hidden name=t value=";
  h += webToken;
  h += ">";
  static const uint16_t CHOICES[] = { 1000, 3000, 5000, 10000 };
  for (uint8_t i = 0; i < 4; i++) {
    h += "<button name=open_ms value=";
    h += String((unsigned)CHOICES[i]);
    if (settings.openMs == CHOICES[i]) h += " class=on";
    h += ">";
    h += String((unsigned)(CHOICES[i] / 1000));
    h += "s</button> ";
  }
  h += "</form></div>";
  h += "<div class=row><div>Card list<br><small>fetch it from the server now</small></div>"
       "<form method=post action=/set><input type=hidden name=t value=";
  h += webToken;
  h += "><button name=sync value=1>Sync now</button></form></div>";

  h += "<h2>Recent taps</h2><table>";
  if (tapLogCount == 0) h += "<tr><td colspan=2><small>none since boot</small></td></tr>";
  for (uint8_t i = 0; i < tapLogCount; i++) {
    const TapLog &t = tapLog[(tapLogHead + TAP_LOG_N - 1 - i) % TAP_LOG_N];
    h += "<tr><td>"; h += fmtLocalTime(t.localSecs); h += " &middot; ..."; h += t.tail;
    h += "</td><td>"; h += t.what; h += "</td></tr>";
  }
  h += "</table><p><small>The door relay cannot be opened from this page.</small></p></body></html>";

  web.sendHeader("Cache-Control", "no-store");
  web.send(200, "text/html; charset=utf-8", h);
}

void webSet() {
  if (!webAuthOk()) return;
  if (webToken[0] == '\0' || web.arg("t") != webToken) {
    web.send(403, "text/plain", "Stale page. Go back, reload and try again.");
    return;
  }
  String v;
  if ((v = web.arg("offline_test")) != "") {
    testOffline = (v == "on");
    if (!testOffline) lastUploadAttemptMs = 0;  // queued taps may go up now
    Serial.printf("[web] offline test %s\n", testOffline ? "ON" : "OFF");
  }
  if ((v = web.arg("relay")) != "") {
    settings.relayOn = (v == "on");
    saveSettings();
    Serial.printf("[web] relay %s\n", settings.relayOn ? "ON" : "OFF");
  }
  if ((v = web.arg("sound")) != "") {
    settings.soundOn = (v == "on");
    saveSettings();
  }
  if ((v = web.arg("open_ms")) != "") {
    long ms = v.toInt();
    if (ms == 1000 || ms == 3000 || ms == 5000 || ms == 10000) {
      settings.openMs = (uint16_t)ms;
      saveSettings();
      Serial.printf("[web] open time %ld ms\n", ms);
    }
  }
  if (web.arg("sync") == "1") {
    syncDue = true;
    syncBackoffOn = false;
    Serial.println("[web] sync requested");
  }
  newWebToken();  // the page that was just used is spent
  web.sendHeader("Location", "/");
  web.send(303, "text/plain", "");
}

void webStatus() {
  if (!webAuthOk()) return;
  char clock[24];
  formatRtc(clock, sizeof(clock), true);
  String j = "{";
  j += "\"fw\":\"" FW_VERSION "\",";
  j += "\"clock\":\""; j += clock; j += "\",";
  j += "\"uptime_s\":"; j += String((unsigned long)(millis() / 1000UL)); j += ",";
  j += "\"wifi_rssi\":"; j += String((int)WiFi.RSSI()); j += ",";
  j += "\"offline_test\":"; j += testOffline ? "true" : "false"; j += ",";
  j += "\"relay_on\":"; j += settings.relayOn ? "true" : "false"; j += ",";
  j += "\"relay_open_ms\":"; j += String((unsigned)settings.openMs); j += ",";
  j += "\"sound_on\":"; j += settings.soundOn ? "true" : "false"; j += ",";
  j += "\"cards_cached\":"; j += String((unsigned long)cardsCached); j += ",";
  j += "\"last_sync_day\":"; j += String((unsigned long)cacheSyncDay); j += ",";
  j += "\"taps_queued\":"; j += String((unsigned long)eventsQueued);
  j += "}";
  web.sendHeader("Cache-Control", "no-store");
  web.send(200, "application/json", j);
}

// Start the server once WiFi is up, then serve requests from loop().
void maintainWeb() {
  if (sizeof(WEB_PASSWORD) <= 1) return;  // empty password: page disabled
  if (!webStarted) {
    if (WiFi.status() != WL_CONNECTED) return;
    const char *hdrs[] = { "Authorization" };
    web.collectHeaders(hdrs, 1);
    web.on("/", HTTP_GET, webRoot);
    web.on("/set", HTTP_POST, webSet);
    web.on("/status.json", HTTP_GET, webStatus);
    web.onNotFound([]() { web.send(404, "text/plain", "Not found"); });
    web.begin();
    bool mdns = MDNS.begin("rfid-reader");
    webStarted = true;
    Serial.printf("[web] settings page at http://%s/%s\n", WiFi.localIP().toString().c_str(),
                  mdns ? " (also http://rfid-reader.local/)" : "");
  }
  web.handleClient();
}

// The RC522 occasionally stops answering (brown-out, EMI). Re-init if so.
void checkRc522() {
  if (millis() - lastRc522CheckMs < RC522_CHECK_MS) return;
  lastRc522CheckMs = millis();
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  if (v == 0x00 || v == 0xFF) {
    Serial.printf("[rc522] not answering (0x%02X), re-initialising\n", v);
    rfid.PCD_Init();
  }
}

// ---------------------------------------------------------------------------
// Setup / loop
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.printf("[boot] Lord of Gyms RFID reader fw %s, label \"%s\"\n", FW_VERSION, DEVICE_LABEL);

  // The relay first, before anything slow: the door must never open by accident.
  pinMode(RELAY_PIN, OUTPUT);
  relayWrite(false);

  pinMode(BUZZER_PIN, OUTPUT);
  buzzerWrite(false);
  for (uint8_t i = 0; i < 4; i++) {
    // No effect on GPIO34-39 (input-only): those need an external pull-up.
    if (BTN_PINS[i] >= 0) pinMode(BTN_PINS[i], INPUT_PULLUP);
  }

  Wire.begin(I2C_SDA, I2C_SCL);
  Serial.printf("[i2c] OLED 0x%02X %s, DS3231 0x68 %s\n", OLED_ADDR,
                i2cPresent(OLED_ADDR) ? "found" : "MISSING",
                i2cPresent(0x68) ? "found" : "MISSING");

  oledOk = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  if (!oledOk) Serial.println("[oled] init failed");
  else showMessage("BOOT", "fw " FW_VERSION, "");

  rtcOk = rtc.begin();
  if (!rtcOk) {
    Serial.println("[rtc] DS3231 not found");
  } else {
    rtcTimeValid = !rtc.lostPower() && rtc.now().year() >= MIN_VALID_YEAR;
    Serial.printf("[rtc] %s\n", rtcTimeValid ? "time valid" : "time not set (waiting for NTP)");
  }

  SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI, RC522_SS);
  rfid.PCD_Init();
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.printf("[rc522] version 0x%02X %s\n", v,
                (v == 0x00 || v == 0xFF) ? "(NOT FOUND - check wiring/3.3V)" : "");
  lastRc522CheckMs = millis();

  fsOk = LittleFS.begin(true);  // true: format on first boot / corruption
  if (!fsOk) Serial.println("[fs] LittleFS mount failed: offline mode disabled");
  loadMeta();
  loadSettings();
  eventsQueued = countEvents();
  Serial.printf("[fs] %s, %lu cached card(s), %lu tap(s) queued\n", fsOk ? "ok" : "FAILED",
                (unsigned long)cardsCached, (unsigned long)eventsQueued);
  Serial.printf("[cfg] relay %s, open %u ms, sound %s, keypad %s\n",
                settings.relayOn ? "on" : "off", (unsigned)settings.openMs,
                settings.soundOn ? "on" : "off",
                BTN_PINS[3] >= 0 ? "wired" : "not configured (serial: o r s i)");

  Serial.printf("[web] settings page %s\n",
                sizeof(WEB_PASSWORD) > 1 ? "enabled (starts when WiFi is up)"
                                         : "disabled (WEB_PASSWORD is empty)");

  sntp_set_time_sync_notification_cb(onNtpSync);
  connectWifi();
  wifiWasConnected = false;  // let maintainWifi() log + start NTP
  maintainWifi();

  startBeep(BEEP_SHORT, PATTERN_LEN(BEEP_SHORT));
  enterState(ST_IDLE);
}

void loop() {
  uint32_t now = millis();

  updateBeep();
  updateRelay();
  maintainWifi();
  updateNtp();
  serialCommands();
  maintainWeb();
  uint8_t keys = pollButtons();

  switch (state) {
    case ST_IDLE:
      if (k4LongFired) {
        k4LongFired = false;
        startSettings();
        break;
      }
      if (keys & 0x01) {  // K1: info screen
        drawInfo();
        state = ST_INFO;
        stateSinceMs = now;
        break;
      }
      if (now - lastIdleDrawMs >= IDLE_REDRAW_MS) {
        lastIdleDrawMs = now;
        drawIdle();
      }
      checkRc522();
      handleCard();
      // Background network work only while idle, one request per pass, so a
      // card tapped meanwhile waits at most for a single page. Not while the
      // relay is open (a slow request must not stretch the door-open time) and
      // not during the offline test (taps must stay queued).
      if (state == ST_IDLE && !relayActive && !testOffline) {
        if (!uploadStep()) syncStep();
      }
      break;

    case ST_INFO:
      if (now - stateSinceMs >= INFO_HOLD_MS) {
        enterState(ST_IDLE);
        break;
      }
      handleCard();  // a tap cuts the info screen short
      break;

    case ST_PIN:
      k4LongFired = false;  // still holding from the entry gesture: ignore
      if (now - menuLastKeyMs >= PIN_IDLE_TIMEOUT_MS) { enterState(ST_IDLE); break; }
      handlePinKeys(keys);
      break;

    case ST_MENU:
      k4LongFired = false;
      if (now - menuLastKeyMs >= MENU_IDLE_TIMEOUT_MS) { enterState(ST_IDLE); break; }
      handleMenuKeys(keys);
      break;

    case ST_RESULT:
      if (now - stateSinceMs >= RESULT_HOLD_MS) enterState(ST_IDLE);
      break;
  }
}
