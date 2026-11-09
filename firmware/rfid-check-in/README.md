# RFID check-in reader (ESP32)

A door reader for Lord of Gyms. A member taps their RFID card; the reader sends
the card UID to the `rfid-check` Edge Function, which records the visit and
answers **allow** or **deny**. The OLED shows the answer and the buzzer beeps.

Online, the reader never decides anything itself: membership, dues and card
ownership all live in the backend. If the server cannot be reached it falls back
to **offline mode** (below) using a copy of the allow-list it keeps in flash.

## Hardware

- ESP32 DevKit, 30-pin (CP2102, USB-C)
- RFID-RC522 module (13.56 MHz, MIFARE cards and fobs)
- DS3231 RTC module with a CR2032 coin cell
- 128x64 SSD1306 I2C OLED (0.96" or 1.3") at address 0x3C, with the 4-button keypad (K1-K4)
- Buzzer (active buzzer module, or a buzzer driven through a transistor)
- Door relay: single-channel transistor board (HW-482, JQC3F-05VDC-C, 10 A), active-HIGH, on GPIO26

## Wiring

| Module | Module pin | ESP32 pin | Notes |
|---|---|---|---|
| RC522 | SDA (SS) | GPIO5 | VSPI SS |
| RC522 | SCK | GPIO18 | VSPI |
| RC522 | MOSI | GPIO23 | VSPI |
| RC522 | MISO | GPIO19 | VSPI |
| RC522 | RST | GPIO27 | |
| RC522 | IRQ | not connected | |
| RC522 | 3.3V | 3V3 | **3.3 V only. 5 V damages the RC522.** |
| RC522 | GND | GND | |
| DS3231 | SDA | GPIO21 | shared I2C bus |
| DS3231 | SCL | GPIO22 | shared I2C bus |
| DS3231 | VCC / GND | 3V3 / GND | |
| OLED | SDA | GPIO21 | shared I2C bus, address 0x3C |
| OLED | SCL | GPIO22 | shared I2C bus |
| OLED | VCC / GND | 3V3 / GND | |
| Buzzer | + / signal | GPIO25 (default) | set `BUZZER_PIN` in `config.h` |
| Buzzer | - | GND | |
| Keypad | K1 | GPIO13 | the `^` button; button to GND, read active-low (`BTN_K1_PIN`) |
| Keypad | K2 | GPIO14 | the `v` button |
| Keypad | K3 | GPIO16 | the `#` button |
| Keypad | K4 | GPIO17 | the `*` button |
| Relay | IN | GPIO26 | energised when HIGH (`RELAY_ACTIVE_HIGH`) |
| Exit switch | button 1 | GPIO32 | momentary NO button to GND (`EXIT_BTN_PIN`); GPIO16/17 stay K3/K4 |
| Exit switch | button 2 (optional) | GPIO33 | second inside button on its own wire (`EXIT_BTN2_PIN`, `-1` = unused) |
| Relay | VCC / GND | VIN (5 V) / GND | **5 V, not 3V3**: the coil is a 5 V part |

The OLED board's header is `GND VCC SCL SDA K4 K3 K2 K1`. Only the first four
carry wires; **K1..K4 must each be wired to a GPIO** (the table above uses the
free pins 13, 14, 16, 17 and `config.h` says the same via `BTN_K1_PIN` ...). Set a
button to `-1` to leave it unused. The firmware uses `INPUT_PULLUP`, but
**GPIO34, 35, 36 and 39 have no internal pull-ups**: a button on one of those
pins needs an external 10 kΩ resistor from the pin to 3.3 V.

## Door relay

An allowed tap (online, or offline from the cached list) energises the relay for
`RELAY_OPEN_MS` (default 3 s; the menu offers 1/3/5/10 s). That includes `ALREADY
IN`, so a member who stepped out can come back in. Denied taps, unknown cards,
offline-not-recorded and device errors never open it.

- Wire the door strike through the relay's **COM + NO** contacts on the strike's
  own supply. Whether the lock is fail-safe or fail-secure is a hardware choice.
- The firmware drives GPIO26 to "off" as the very first thing at boot.
- Background sync/upload is held off while the relay is open, so a slow request
  cannot stretch the open time.
- Inverted module (opto-isolated "low-level trigger")? Set `RELAY_ACTIVE_HIGH 0`.

## Exit switch (button inside the door)

A doorbell-style momentary button wired between GPIO32 and GND (internal
pull-up, no resistor) releases the door **without a card**: people inside press
it and the relay opens for the **Exit time** (menu "Exit time" or the web page:
3 / 5 / 10 s, default 5 s, separate from the card-tap open time). Several
buttons can be wired in parallel on one pin; GPIO33 is an optional second input.

- The OLED shows **GATE OPEN** with a "Closing in Ns" countdown and a draining
  bar until the relay releases, then returns to the clock screen. A card tapped
  meanwhile is still judged normally.
- Purely local: no network call, so it works with WiFi down and during the
  offline test. Works from any screen, including the settings menu.
- One release per press (holding does nothing more); presses within 1 s of the
  last one are ignored.
- The master **Relay** setting still applies: Relay OFF = the exit switch does
  nothing. Presses show in the web page's recent list as `EXIT SWITCH n` (RAM
  only, not uploaded; there is no card, so no attendance row).
- Long wire runs inside walls can pick up noise: use twisted pair and, if the
  door opens by itself, a 100 nF capacitor across the button.
- This is a convenience, not certified fire egress. Whether the strike is
  fail-safe or fail-secure is still a hardware choice.

- Check it: menu -> **Relay test**, or send `r` over USB serial.

## Settings menu

Hold **K4 for 3 s** on the idle screen, then press the code on the keypad
(`SETTINGS_PIN` in `config.h`, default `1234` = K1,K2,K3,K4; `""` = no code).
K1 = up, K2 = down, K3 = change/run, K4 = back. It closes itself after 30 s
without a key; a wrong code returns to the idle screen. Card taps are ignored
while it is open.

| Item | What it does |
|---|---|
| Offline test | Skips the server and decides from the cached list; taps are queued and upload/sync pause until you switch it off. Idle screen shows `* OFFLINE TEST *`. **Not saved**: a reboot switches it off. |
| Relay | ON/OFF (saved). Off means allowed taps no longer open the door. |
| Open time | 1 / 3 / 5 / 10 s (saved). |
| Result time | How long the result screen stays, 0.5 / 1 / 2 / 3 s (default 0.5 s). No card is read while it shows. Also on the web page. |
| Repeat wait | A card just read is ignored if tapped again within 0.5 / 1 / 2 / 3 s (default 0.5 s). Also on the web page. |
| Relay test | Pulses the relay once now, even if Relay is OFF (it is a wiring check). |
| Sound | ON/OFF (saved). |
| Door QR | ON/OFF (saved, fw 1.4.0). ON shows the rotating QR on the idle screen and polls for scans; OFF gives the plain clock screen back and stops all QR traffic. Reads `NO KEY` while ON but the secret has not been fetched yet. Also on the web page. |
| Sync now | Fetches the card list straight away. |
| Back | Close the menu. |

Settings live in `/settings.bin` on the reader's flash. Without a keypad, the
same switches are on USB serial (115200): `o` offline test, `r` relay test,
`s` sync now, `i` status.

## Software setup (Arduino IDE 1.8.19, Windows)

1. **Board support.** File -> Preferences -> Additional Boards Manager URLs:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`.
   Tools -> Board -> Boards Manager -> install **esp32 by Espressif Systems**, a
   **2.0.x** release (2.0.17 is the last 2.x). The sketch is written to compile on 3.x too, but has only been checked against 2.x APIs.
2. **Board settings.** Tools -> Board -> **ESP32 Dev Module**. Upload speed
   921600 (drop to 115200 if uploads fail). Port: the CP2102 COM port (install
   the Silicon Labs CP210x driver if no port appears).
3. **Libraries.** Sketch -> Include Library -> Manage Libraries, install:

   | Library | Author | Version |
   |---|---|---|
   | MFRC522 | GithubCommunity | 1.4.x (1.4.11 tested API) |
   | RTClib | Adafruit | 2.1.x (installs Adafruit BusIO when asked: say "Install all") |
   | Adafruit GFX Library | Adafruit | 1.11.x |
   | Adafruit SSD1306 | Adafruit | 2.5.x |
   | ArduinoJson | Benoit Blanchon | **6.21.x** (not 7.x) |

   `WiFi`, `WiFiClientSecure`, `HTTPClient`, `SPI`, `Wire`, LittleFS and mbedTLS
   come with the ESP32 core. The QR encoder (fw 1.4.0) is **vendored** in this
   folder (`lg_qrcode.c` / `lg_qrcode.h`, from ricmoo/QRCode, MIT): there is
   nothing extra to install, and the IDE compiles it with the sketch. Keep the
   two files next to `rfid-check-in.ino`. ArduinoJson 7 still compiles this sketch with deprecation
   warnings, but 6.21.x is what it was written against.

## Register the reader and get its key

1. In the web console go to **Settings -> Devices** (`/settings/devices`).
2. In **Register a reader**, pick the branch the reader is installed at, give
   it a name and click **Register reader**.
3. The console shows the device key (starts with `lgd_`) **once**. Copy it now.
   Only its sha256 hash is stored, so it cannot be shown again; if you lose
   it, rotate the key (below).

## Configure and flash

1. In this folder, copy `config.h.example` to `config.h` (same folder as
   `rfid-check-in.ino`).
2. Edit `config.h`:
   - `WIFI_SSID`, `WIFI_PASS`: a 2.4 GHz network.
   - `DEVICE_KEY`: the `lgd_...` key from the console.
   - `DEVICE_LABEL`: a short name for the screen, e.g. `"Front door"`.
   - `RFID_ENDPOINT`: leave as is.
   - `BUZZER_PIN`, `BUZZER_ACTIVE_HIGH`, `BTN_K1_PIN`..`BTN_K4_PIN`: match your wiring.
3. Open `rfid-check-in.ino` in the IDE (`config.h` appears as a second tab),
   Verify, then Upload.
4. Open Tools -> Serial Monitor at **115200 baud** to watch the boot log.
   The device key is never printed.

`config.h` is git-ignored (`firmware/**/config.h`). Never commit it.

## What the reader shows

Time comes from the DS3231. After WiFi connects the reader syncs the RTC from
NTP (`pool.ntp.org`, `time.google.com`) in Nepal time, UTC+5:45, and again
every 24 hours. The RTC is only written after a fresh NTP reply (waits up to
15 s); if none arrives it is left alone. The RTC holds local time; the `ts` sent to the server is
converted back to real Unix seconds.

| State | OLED | Beep |
|---|---|---|
| Boot | `BOOT`, then `WIFI` + SSID + progress dots (up to 20 s) | one short beep when ready |
| Idle | label + WiFi state, large clock, date, `TAP CARD` | - |
| Idle with Door QR (fw 1.4.0, default ON once the secret is fetched) | the QR tile on the left, on the right the clock, `SCAN WITH APP or TAP CARD` and a bar that drains over the 30 s the code lives. With WiFi down the right side says `WIFI DOWN` / `TAP CARD` (the code still rotates, but a scan cannot open the door) | - |
| Phone scan accepted | same as Allowed, with the member code in the top-left; the visit is recorded by the server | 1 short |
| Checking | `CHECKING` + card UID | - |
| Allowed | top row: the card number (small, left) and the name (small, right; a long name is shortened to `Ramesh S.`); then the days left as the biggest number with `DAYS LEFT` under it (`1` / `DAY LEFT`, `LAST` / `DAY` on the last day, `OK` / `NO LIMIT` for open-ended plans). A second tap today looks the same. No `ALLOW`, `WELCOME` or `ALREADY IN` word | 1 short |
| Denied: dues | `PAY DUES` and `Rs 1,500.5` big (from `due_paisa`, grouped like the console; paisa dropped from Rs 1,00,000) | 1 long |
| Denied: expired | `EXPIRED` big, and under it the day the membership ended: `12 OCT` if this year, `12 OCT 25` for an earlier year. Without a known date: `EXPIRED` alone | 1 long |
| Denied: frozen / not started / no membership / left | `FROZEN` / `NOT` `STARTED` / `NO PLAN` / `NOT A` `MEMBER`, as big as fits. The member knows to see the desk, so there is no extra line | 1 long |
| Unknown card | `UNKNOWN` `CARD` big | 3 short |
| Bad read | `BAD READ` `TAP AGAIN` big | 3 short |
| Key unknown (HTTP 401) | `SETUP` `DEVICE KEY` big, `Check config.h` | 1 long |
| Reader disabled (HTTP 403) | `READER` `DISABLED` big, `Enable in console` | 1 long |
| Cached allow (fast path) | same as Allowed, from the list: card number, the cached name, days left big | 1 short |
| Offline, card allowed | same as Allowed with a small `OFFLINE` (or `NOT LOGGED`) under the top row, days number one size smaller | offline pattern |
| Offline, any other status | the same denied screens as online: expired date, `FROZEN`, `NOT STARTED`, `NO PLAN`, `NOT A MEMBER`, `PAY DUES` (no amount offline) | 1 long (2 long for dues) |
| Offline, card not in the list | `UNKNOWN` `CARD` big | 3 short |
| Offline and never synced (no list yet) | `OFFLINE` `NOT SAVED` big, cause | 1 long |
| K1 pressed (idle) | info for 5 s: label, IP, RSSI, RTC date/time, firmware version, `C<cards cached> Q<taps queued>` | - |

Beeps by ear (an active buzzer has one pitch, so the rhythm is the message):

| Beep | Meaning |
|---|---|
| 1 short | in |
| 2 short | in, but 7 days or fewer left |
| short + medium | in, offline (decided from the cached list) |
| 3 short | card not enrolled, or a misread: send them to the desk |
| 2 long | dues owing |
| 1 very long | refused (expired, frozen, not started, left) or a reader problem |

Menu -> **Sound test** (or `b` on USB serial) plays short, double, very long, even
with Sound OFF, so the buzzer wiring can be checked. Sound OFF silences every
other beep.

Results stay on screen for 3 seconds. The same card is ignored for a further
3 seconds after the result clears so a lingering card does not double-post (the server also
records at most one visit per member per day).

**Enrolling a new card:** the member taps the new card; the reader shows
`UNKNOWN CARD` and remembers the UID. At the desk, open the member's profile
-> **Access card** -> **Assign card**, and pick the UID under **Recent unknown
cards** (or type it in). The next tap is checked normally.

## Offline mode (fw 1.1.0)

The reader keeps a copy of the allow-list in its flash (LittleFS) so the door
keeps working when WiFi or the server is down. Sizing: 5,000 members is
about 240 KB of the 1.5 MB data partition (48 bytes a card: UID, status, date and the holder's name; a reader on fw 1.3.0 re-syncs once because the record format grew). Lookups are a
binary search over the sorted file (about 13 reads for 5,000 cards, so a tap's
cache check stays in the low milliseconds; Serial prints `[cache] lookup N us`).
The reader checks while it syncs that the list is strictly ascending; if the
server ever sent it in another order it logs a warning and falls back to a
linear scan, which is slower but still correct.

- **Sync down.** As soon as WiFi is up, then every 3 minutes for a list up to 500 cards, 8 minutes up to 2,000 and 15 minutes above that (it was a flat 15 before fw 1.3.0, so a big gym does not re-download and rewrite its whole list every few minutes), the reader pulls
  the list from the `rfid-sync` Edge Function (`GET`, 500 cards per page, one
  page per idle pass so a tap never waits behind more than one page). Every
  live card is on the list with its status (allowed, dues, expired, frozen,
  not started, no membership, left); allowed ones carry the last day they may
  enter, which is how `N Days Left` is worked out offline. The new list
  replaces the old one only after the last page arrives. A failed sync retries after 1 minute.
- **Cache-first (fw 1.3.0).** A card the list says is allowed opens the door at
  once with no server round trip (an HTTPS call cost 3-5 s). The tap is queued
  and uploaded within ~30 s. The screen shows the card number, the cached name and
  the days left. This needs a sync newer than ~7 minutes and a valid clock;
  otherwise, and for every card that is not a clean allow (unknown, expired,
  dues, staff), the reader asks the server as before. Trade-off: a card
  revoked or newly in arrears still opens the door for up to one sync interval.
- **Staff cards (fw 1.3.0).** The list also carries staff cards as status `S`,
  only for active staff who may enter at this reader's branch (owners anywhere).
  With a fresh list a staff tap is as fast as a member's: the door opens from the
  cache and the screen shows `STAFF` and `TIME SAVED` (not IN or OUT, because only the
  server holds the shift state; the staff screen shows which it was). When the
  server answers instead (stale list, no clock) it shows `CLOCK IN` /
  `CLOCK OUT` / `ALREADY IN`. Offline, the
  door opens and shows `STAFF`; the tap is queued with its real time and the
  server turns it into a clock-in/out stamped with the tap time (source
  `offline_card`) when the reader reconnects. Staff taps are never collapsed to
  one per day (a person clocks in and out); a repeat within 60 s is ignored.
  A reader with no trusted clock still opens for staff but says `NOT LOGGED`.
  A deactivated or moved person stays on the list until the next sync, the same
  window as a revoked member card.
- **Decide locally.** Otherwise a tap goes to the server first. Only if the server does not
  answer (no WiFi, timeout, 5xx) does the reader check the list. After one
  failed round trip it fails faster (5 s) for the next minute so a dead server
  does not stall the door.
- **Queue and upload.** Taps allowed offline are queued in flash (max 2,000, one
  per card per day) and uploaded in batches of 50 through `rfid-sync` (`POST`)
  once the network is back. The visit is recorded with the reader's own time as
  `checked_in_at`, attributed to this reader, and uploads are idempotent per
  member per day. Denied taps are not queued.
- **Not available offline:** dues amounts, "already in" detection,
  and enrolling a new card (an unknown card shows `UNKNOWN CARD`, but is not
  remembered for the desk).
- **Names are stored on the reader.** The list carries each holder's name (printable
  ASCII, 20 characters, other characters shown as `?`) so a cached tap can greet
  them. Anyone with the reader in hand can read that flash; the web page is behind
  the password and the list travels over HTTPS.

- **If the server refuses the reader** (401 unknown key / 403 disabled), on a tap,
  a sync or an upload, the reader **throws the cached list away**: a disabled or
  re-keyed reader must not keep opening the door whenever the network drops. It
  then shows `OFFLINE / NOT RECORDED` until a sync succeeds again.
- **Queue full or flash error:** an allowed offline tap still opens the door but
  the screen says `NOT LOGGED` instead of `OFFLINE`, because the visit could
  not be queued.
- **A dead server never stalls the door for long:** after one failed round trip
  the reader skips background sync/upload for a minute and uses 4-5 s timeouts.

**Known trade-off:** the cached list is trusted until the next sync. A card
revoked, or a member who starts owing, can still enter while the reader is
offline, so the exposure is as long as the outage.

**Clock:** offline decisions compare against the RTC. If the RTC has lost power
(empty battery) and WiFi is down at boot, the reader has no date; it then judges
against the day of the last successful sync, and queued taps are uploaded without
a time (the server stamps them at upload). Fit a CR2032 to avoid this.

## WiFi settings page

A small page on the reader for the same switches as the keypad menu, from a
phone or laptop on the gym WiFi: `http://<reader IP>/` (the IP is on the K1 info
screen and in the Serial log) or `http://rfid-reader.local/`. Set `WEB_PASSWORD`
in `config.h` to turn it on; **an empty password turns the page off**. Username
is `WEB_USER` (default `admin`).

- **Can do:** Offline test on/off, Relay on/off, Open time, Sound, Door QR on/off, Sync now.
  Shows firmware, clock, WiFi, cards cached, last sync, queued taps and the last
  10 taps (time, last 4 hex of the UID, result). `/status.json` has the same
  status for scripts.
- **Cannot do:** open the door. There is no relay-test route; that stays on the
  keypad and USB serial.
- **Protection:** HTTP Basic password; 5 wrong passwords lock the page for 60 s;
  every change needs a one-use token from the page you just loaded, so another
  web page cannot silently post to the reader.
- **Limit:** it is plain HTTP (the ESP32 does not serve HTTPS here), so the
  password crosses the LAN unencrypted. Use a long password used nowhere else and
  keep the reader's WiFi trusted.

## QR protocol (door-display QR check-in, server side live; firmware 1.4.0)

The OLED shows a rotating QR; a member scans it with the app, the server checks
the code, records the visit (`method = 'qr'`) and queues an unlock; the reader
polls for it and opens the relay. The backend is deployed and proven; firmware
1.3.0 ignores all of it and keeps working unchanged.

**Code.** Everything is decimal ASCII, no padding in the message.
## Door QR (fw 1.4.0)

The idle screen shows a QR code that changes every 30 seconds. A member scans it
with the app; the server checks the code, records the visit (`method = 'qr'`) and
queues an unlock; the reader polls for it and opens the relay exactly like an
allowed card tap (ALLOWED screen with the name and days left). Cards keep working
as before; the QR is an extra way in. The server side (migration
`20261109131000_door_qr`, Edge Functions `rfid-sync?qr=1` and `rfid-poll`) must be
deployed first; against an older server the reader just keeps the plain clock
screen (`NO KEY`).

- **Code on screen.** `LG1.<qr_id>.<8 digits>`, at most 19 characters, which is
  always a **version 1** QR (21x21 modules, alphanumeric mode, error correction
  L). It is drawn at 2 px per module with a 4-module white quiet zone: a 58 x 58 px
  white tile on the left of the OLED (black modules on white reads best), 58 x 58
  of the 64 px height. 3 px modules do not fit (21 modules x 3 = 63 px leaves no
  quiet zone), so 2 px is the best fit for 128x64. Physical size: on a **0.96"**
  panel (about 0.17 mm pixels) a module is ~0.34 mm, the code ~7.1 mm and the tile
  ~9.9 mm; on a **1.3"** panel (about 0.23 mm pixels) ~0.46 mm, ~9.7 mm and ~13.3 mm.
  Both scan from roughly 5-15 cm with a phone; the larger 1.3" panel is easier,
  and the member should hold the phone steady rather than far away. Panels vary,
  so check the real figures with a ruler on your module.
- **Needs a clock.** The code is computed from the secret and the time, so it
  needs a valid RTC. The reader corrects for a drifting RTC from the server's
  `server_time` (every poll), so a clock a minute off still gives valid codes;
  the RTC itself is only rewritten from NTP.
- **Rotates offline.** The secret and `qr_id` are cached in flash (`/qr.bin`), so
  the code keeps rotating through a WiFi outage. A scan can only open the door
  while the reader is online (it learns about the scan by polling), so the screen
  then says `WIFI DOWN` / `TAP CARD`.
- **Polling.** About once a second while idle, online and not in offline test,
  with a 1.5 s timeout and a kept-open TLS connection so a card tap is never held
  up. After 3 failures in a row it slows to every 5 s; a 401/403/404 (setup
  problem) is retried every 30 s. With the QR switched off (menu **Door QR** or the
  web page) the reader makes no QR requests at all; Offline test also suspends it.
- **`RFID_POLL_ENDPOINT`.** The poll URL is derived from `RFID_SYNC_ENDPOINT` by
  replacing `rfid-sync` with `rfid-poll`. If your functions live elsewhere, add
  the commented line from `config.h.example` and set it explicitly.
- **Security.** The code is HMAC-SHA256 with a per-reader secret, valid for the
  current 30 s window and one either side. Like the device key, the secret is in
  the reader's flash; rotating the device key rotates the secret. The reader
  throws it away on a 401/403.

### Protocol

Everything is decimal ASCII, no padding in the message.

```
window  = floor(unix_epoch_seconds / 30)          // RTC/NTP time, UTC
message = "<qr_id>:<window>"                       // e.g. "7:56789012"
mac     = HMAC-SHA256(key = qr_secret (32 raw bytes), message)
code    = lpad( (uint32_big_endian(mac[0..3]) % 100000000), 8, "0" )
payload = "LG1." + qr_id + "." + code              // QR text, e.g. "LG1.7.06036629"
```

`uint32_big_endian(mac[0..3]) = mac[0]<<24 | mac[1]<<16 | mac[2]<<8 | mac[3]`
(use `uint32_t`; the `% 100000000` is on the unsigned value). The payload is at
most 4 + 6 + 1 + 8 = 19 characters (`qr_id` is 1..999999), so a version 1-2
QR (ECC L or M, alphanumeric/byte mode) is enough. The server accepts the
current window and the one either side (so +-30 s of clock drift is fine;
anything further is `invalid_code`). Redraw only when the window changes.

**Test vector** (both the SQL test `supabase/tests/door_qr.sql` and
`scripts/door-qr-sim.mjs` assert it; the firmware should too, once, at boot in
a debug build):

| | |
|---|---|
| secret (hex, 32 bytes) | `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f` |
| qr_id 7, window 56789012 (message `7:56789012`) | `06036629`  (payload `LG1.7.06036629`) |
| qr_id 7, window 56789013 | `61789799` |
| qr_id 1, window 0 (message `1:0`) | `75481906` |

**Fetch the secret** -- `GET /functions/v1/rfid-sync?qr=1`, header `x-device-key`
(opt-in; a plain `GET rfid-sync` still returns the text card list, byte for
byte as before):

```
200 application/json
{ "qr": { "qr_id": 7, "secret_b64": "mgmsgcWJqvfoj8oBaHvV8fz6dM5uXhvd+7zhtOfKRx8=" },
  "server_time": 1794206366 }
401 { "decision":"deny", "reason":"device_unknown" }    unknown / missing key
403 { "decision":"deny", "reason":"device_disabled" }   disabled reader (no secret is returned)
```

`secret_b64` is standard base64 of the 32 raw key bytes (44 chars, with `=`
padding); decode it (mbedtls `mbedtls_base64_decode`) and keep the bytes in
flash. `server_time` is unix seconds; use it to set the clock if the RTC looks
wrong. Refetch at every boot while online, and again after a 401. The secret is
rotated when the device key is rotated (`rotate_device_key`), so a reader that
is reflashed with a new key gets the matching new secret on its first fetch.

**Poll for an unlock** -- `GET /functions/v1/rfid-poll`, header `x-device-key`,
about once a second while idle and online (it is cheap):

```
200 { "unlock": null, "server_time": 1794206371 }                      nothing waiting
200 { "unlock": { "member_name": "Zed Proof", "member_code": "M00001",
                  "days_to_expiry": 25, "status": "active" },
      "server_time": 1794206412 }                                       open the door now
401 / 403   as above;  405 for any method other than GET
```

An unlock is handed out exactly once; the next poll returns `null`. Requests
older than 20 s are never returned (a late scan cannot open the door). On
`unlock` the reader runs the same path as an allowed card tap: relay for
`RELAY_OPEN_MS`, the ALLOWED screen with `member_name` and `days_to_expiry`
(`days_to_expiry` may be `null` for an open-ended membership; `member_name` is
free text, fold it to printable ASCII and trim it like the sync list does).
Attendance is already recorded by the server; the reader must not also POST a
check-in for a QR unlock.

**What the member's app calls** (for reference; the reader never calls it):
`member_door_check_in(p_payload)` returns `{ result: ok | denied |
invalid_code | closed | rate_limited, reason?, member_name, days_to_expiry,
due_paisa, already_checked_in_today, status, branch_name }`. `closed` carries
`reason: outside_hours` (the branch's `opens_at`..`closes_at`, org timezone) or
`device_disabled`; `denied` carries the card reasons (`expired`, `dues`,
`frozen`, `upcoming`, `none`, `left`); 10 bad codes in 10 minutes make a member
`rate_limited`. Simulate the whole thing without hardware with
`scripts/door-qr-sim.mjs`.
The server accepts the current window and the one either side. The app needs
the `LG1.` prefix, so the payload cannot be shortened.

**Fetch the secret** -- `GET rfid-sync?qr=1&limit=1`, header `x-device-key`
(the reader adds `limit=1` so an older server that ignores `qr=1` answers with one
card line instead of the whole list). Fetched at boot once online, then every sync
interval:

```
200 { "qr": { "qr_id": 7, "secret_b64": "mgmsgcWJqvfoj8oBaHvV8fz6dM5uXhvd+7zhtOfKRx8=" },
      "server_time": 1794206366 }
401 { "decision":"deny", "reason":"device_unknown" }
403 { "decision":"deny", "reason":"device_disabled" }   (no secret returned)
```

**Poll for an unlock** -- `GET rfid-poll`, header `x-device-key`:

```
200 { "unlock": null, "server_time": 1794206371 }
200 { "unlock": { "member_name": "Zed Proof", "member_code": "M00001",
                  "days_to_expiry": 25, "status": "active" }, "server_time": 1794206412 }
401 / 403 / 404 / 405  setup problem, see Troubleshooting
```

An unlock is handed out once and expires after 20 s. The reader does **not** POST a
check-in for it; the server has already recorded the visit.

**Test vector** (the SQL test and `scripts/door-qr-sim.mjs` assert it too). Secret =
bytes `00 01 02 ... 1f` (base64 `AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=`):

| qr_id, window | code |
|---|---|
| 7, 56789012 | `06036629` (payload `LG1.7.06036629`) |
| 7, 56789013 | `61789799` |
| 1, 0 | `75481906` |

To check a flashed reader, add `#define QR_SELFTEST` above the includes in the
sketch (or in `config.h`), upload, and read the Serial log at boot: every
`[qr-selftest]` line must say `PASS` (it checks HMAC-SHA256 against RFC 4231 test
case 1 and these vectors). Remove it again for the field build; it costs ~0.5 KB.

### Rolling back to 1.3.0

Check out the 1.3.0 sketch (`git checkout 05ce180 -- firmware/rfid-check-in/rfid-check-in.ino`;
`lg_qrcode.*` may stay, an unused file is ignored) and upload it. The door then
behaves exactly as before; the server's QR functions are simply never called.
1.3.0 does not recognise the 1.4.0 settings file, so its saved settings (relay,
open/exit/result times, sound) go back to the defaults once: set them again in the
menu. The card list and queued taps are unaffected; `/qr.bin` is ignored.
Going forward again, 1.4.0 reads the 1.3.0 settings file and turns the QR on.

## Security

- **`setInsecure()`**: the reader uses HTTPS but does **not** verify the
  server certificate. Traffic is encrypted, but someone who can intercept the
  gym's WiFi (a rogue access point, ARP spoofing) could impersonate the
  server and read the device key. The key only lets a holder ask "may this
  card in?" for that branch and create check-ins for cards that are assigned,
  but treat a leaked key as compromised. A follow-up is to pin the CA with the
  ESP32 certificate bundle.
- **Rotating a key**: in the console open **Settings -> Devices**, find
  the reader, choose **Rotate key**, copy the new key, update `DEVICE_KEY` in
  `config.h` and re-flash. The old key stops working immediately, so the reader
  shows `DEVICE KEY UNKNOWN` until it is re-flashed.
- **Disabling a reader** (lost or stolen) with **Disable** in **Settings -> Devices** makes it show
  `READER DISABLED`; nothing it sends is recorded.

## Troubleshooting

| Symptom | Fix |
|---|---|
| OLED stays blank, Serial says `OLED 0x3C MISSING` | Some boards use **0x3D**. Change `OLED_ADDR` near the top of the `.ino`. Check SDA=21, SCL=22. |
| 1.3" OLED shows noise or a 2-pixel-shifted image | Many 1.3" modules are **SH1106**, not SSD1306. Use the Adafruit SH110X library (`Adafruit_SH1106G`) instead. |
| `[rc522] version 0x00` or `0xFF` | RC522 not answering: check the 7 SPI wires, and that it is on **3.3 V** (never 5 V). Versions 0x91/0x92 (or 0x88/0xB2 on clones) are fine. |
| Cards not detected but version is fine | Hold the card flat and still for ~1 s; keep metal away from the antenna. |
| Idle shows `Clock not set` / `--:--` | RTC lost time (coin cell flat or missing). Replace the CR2032; the clock is reset from NTP once WiFi is up. |
| `RTC error` | DS3231 not found on I2C (0x68). Check wiring. |
| Clock drifts or is wrong after power cuts | Replace the RTC battery. Some cheap DS3231 boards have a charging circuit meant for LIR2032 cells; with a CR2032 remove the charging diode/resistor. |
| `OFFLINE` + `No WiFi` | Wrong SSID/password or a 5 GHz-only network. The reader retries every 15 s. If it has synced before, taps are now decided from the cached list instead (see Offline mode). |
| Always `OFFLINE MODE`, never a name | The server is failing. Open Serial: `[http]` shows the error. Offline decisions keep the door working meanwhile. |
| K1 shows `C0` | No successful sync yet. Serial `[sync]` lines say why (HTTP 401 = key, 403 = disabled, anything else = network). |
| Menu shows Door QR `NO KEY`, idle screen is the plain clock | The QR secret has not been fetched. Serial `[qr]` says why: `config reply not usable` = the server is not updated (deploy the `door_qr` migration and the `rfid-sync` / `rfid-poll` functions), `device key unknown` / `reader disabled` = fix the key in the console. It retries every minute (every 5 min after a bad key); a reboot retries at once. Needs WiFi and a valid clock. |
| Idle screen shows `WIFI DOWN` / `TAP CARD` | WiFi is not connected, so a phone scan could not open the door. The code still rotates. Cards still work (cached list). |
| App says the code is invalid for every scan | Clock drift. The server accepts the current 30 s window +-1. The reader corrects its RTC from `server_time` on every poll, but only while online: after a long outage with a drifting RTC, or if the Serial log says `server time differs from the RTC by over 30 days`, reset the RTC (replace the CR2032, let NTP set it). Also check the app is scanning the right gym's reader (`qr_id` is per reader). |
| Scan shows success in the app but the door does not open | The reader is not polling or the unlock expired (20 s). Check Serial for `[qr] poll failed (401/403/404/-1)`: 404 = `rfid-poll` not deployed or a wrong `RFID_POLL_ENDPOINT`; -1/timeouts = weak WiFi. Offline test and Relay OFF also stop it. |
| QR is hard to scan | Hold the phone 5-15 cm away and steady; the code is small on a 0.96" panel. Turn the room light down or the phone brightness up if the OLED glares. If it never scans, turn Door QR OFF and tell us the panel size. |
| Compile error `lg_qrcode.h: No such file` | `lg_qrcode.c` and `lg_qrcode.h` must sit in the same folder as the `.ino`. |
| Compile error `RFID_SYNC_ENDPOINT` | Add the `RFID_SYNC_ENDPOINT` line from `config.h.example` to your `config.h`. |
| `OFFLINE` + `No server reply` / `HTTP 5xx` | Internet down or a server error. Check Serial for the HTTP error. |
| `DEVICE KEY UNKNOWN` | Key mistyped, rotated, or the reader was registered on another project. Re-copy or rotate. |
| Buzzer always on / never on | Flip `BUZZER_ACTIVE_HIGH`. A *passive* buzzer only clicks with this firmware; use an active buzzer module. |
| K1 info screen pops up by itself | The button pin is floating: wrong pin, or GPIO34-39 without an external pull-up. |
| Upload fails "Failed to connect" | Hold BOOT while the IDE says `Connecting...`. Disconnect anything on GPIO0/2/12/15 during upload. |
