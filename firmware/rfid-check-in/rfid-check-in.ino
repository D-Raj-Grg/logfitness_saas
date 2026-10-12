// rfid-check-in.ino -- Lord of Gyms RFID door reader
//
// ESP32 DevKit + RC522 (SPI) + DS3231 RTC + 128x64 SSD1306 OLED (I2C) + buzzer.
// A member taps their card; the reader POSTs the UID to the rfid-check Edge
// Function, which records the visit and answers allow/deny. The OLED and the
// buzzer show the answer. No offline queue: if the server cannot be reached
// the reader shows OFFLINE and nothing is recorded.
//
// Settings live in config.h (copy config.h.example -> config.h). See README.md.
//
// Board: "ESP32 Dev Module", ESP32 Arduino core 2.x, Arduino IDE 1.8.19.
// Libraries: MFRC522 (GithubCommunity), RTClib (Adafruit), Adafruit GFX,
// Adafruit SSD1306, ArduinoJson 6.x.

#include <WiFi.h>
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
#include "sntp.h"  // sntp_set_time_sync_notification_cb (core 2.x; 3.x renames it esp_sntp.h)

#include "config.h"

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
#define RELAY_PIN   26   // reserved for a future door relay; not driven

#ifndef BUZZER_PIN
#define BUZZER_PIN  25
#endif
#ifndef BUZZER_ACTIVE_HIGH
#define BUZZER_ACTIVE_HIGH 1
#endif
#ifndef BTN_K1_PIN
#define BTN_K1_PIN  -1
#endif

#define OLED_ADDR   0x3C
#define OLED_W      128
#define OLED_H      64

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------
#define FW_VERSION            "1.0.0"
#define TZ_OFFSET_SEC         (5 * 3600 + 45 * 60)  // Nepal, UTC+5:45, no DST
#define HTTP_TIMEOUT_MS       8000
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
#define NAME_MAX_CHARS        20

// ---------------------------------------------------------------------------
// Types (declared before any function so the IDE's auto-prototypes compile)
// ---------------------------------------------------------------------------
enum ReaderState { ST_IDLE, ST_RESULT, ST_INFO };

enum ResultKind {
  RES_ALLOW,      // 200 + decision "allow"
  RES_DENY,       // 200 + decision "deny"
  RES_KEY_BAD,    // 401: device key unknown
  RES_DISABLED,   // 403: device disabled in the console
  RES_OFFLINE     // no WiFi, timeout, 5xx, unparseable body ...
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

// Beep patterns: alternating on/off durations in ms, starting with "on".
const uint16_t BEEP_SHORT[]  = { 120 };
const uint16_t BEEP_LONG[]   = { 800 };
const uint16_t BEEP_TRIPLE[] = { 120, 100, 120, 100, 120 };
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

void startBeep(const uint16_t *pattern, uint8_t len) {
  beepPattern = pattern;
  beepLen = len;
  beepIdx = 0;
  beepStepMs = millis();
  buzzerWrite(true);
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
  display.print("FW " FW_VERSION);
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
      if (strcmp(r.status, "expiring") == 0 && r.hasDays) {
        snprintf(line2, sizeof(line2), "Expires in %ld day%s", r.days, r.days == 1 ? "" : "s");
      }
      break;

    case RES_DENY:
      snprintf(big, sizeof(big), "DENY");
      if (strcmp(r.reason, "dues") == 0) {
        snprintf(line1, sizeof(line1), "PAY DUES");
        formatRupees(line2, sizeof(line2), r.duePaisa);
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

  WiFiClientSecure client;
  client.setInsecure();  // no certificate check -- see README "Security"
  client.setHandshakeTimeout(HTTP_TIMEOUT_MS / 1000);  // seconds; default is 120

  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
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
  postCheck(uid, r);  // blocks for up to ~HTTP_TIMEOUT_MS (the only blocking call)
  lastUidMs = millis();

  drawResult(r);
  switch (r.kind) {
    case RES_ALLOW: startBeep(BEEP_SHORT, PATTERN_LEN(BEEP_SHORT)); break;
    case RES_DENY:
      // Triple = "card not enrolled / misread"; long = a real denial.
      if (strcmp(r.reason, "unknown_card") == 0 || strcmp(r.reason, "bad_uid") == 0) {
        startBeep(BEEP_TRIPLE, PATTERN_LEN(BEEP_TRIPLE));
      } else {
        startBeep(BEEP_LONG, PATTERN_LEN(BEEP_LONG));
      }
      break;
    default:        startBeep(BEEP_LONG, PATTERN_LEN(BEEP_LONG)); break;
  }
  state = ST_RESULT;
  stateSinceMs = millis();
}

bool k1Pressed() {
#if BTN_K1_PIN >= 0
  static bool lastLevel = HIGH;
  static uint32_t lastChangeMs = 0;
  bool level = digitalRead(BTN_K1_PIN);
  if (level != lastLevel && millis() - lastChangeMs > 50) {
    lastChangeMs = millis();
    lastLevel = level;
    return level == LOW;
  }
#endif
  return false;
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

  pinMode(BUZZER_PIN, OUTPUT);
  buzzerWrite(false);
  // RELAY_PIN (26) is reserved and deliberately left untouched.
#if BTN_K1_PIN >= 0
  pinMode(BTN_K1_PIN, INPUT_PULLUP);  // no effect on GPIO34-39: add an external pull-up
#endif

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
  maintainWifi();
  updateNtp();

  switch (state) {
    case ST_IDLE:
      if (k1Pressed()) {
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
      break;

    case ST_INFO:
      k1Pressed();  // keep the debouncer in step
      if (now - stateSinceMs >= INFO_HOLD_MS) {
        enterState(ST_IDLE);
        break;
      }
      handleCard();  // a tap cuts the info screen short
      break;

    case ST_RESULT:
      if (now - stateSinceMs >= RESULT_HOLD_MS) enterState(ST_IDLE);
      break;
  }
}
