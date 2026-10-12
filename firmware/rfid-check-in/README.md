# RFID check-in reader (ESP32)

A door reader for Lord of Gyms. A member taps their RFID card; the reader sends
the card UID to the `rfid-check` Edge Function, which records the visit and
answers **allow** or **deny**. The OLED shows the answer and the buzzer beeps.

The reader never decides anything itself. Membership, dues and card ownership
all live in the backend. If the server cannot be reached the reader shows
**OFFLINE** and the visit is **not** recorded (there is no offline queue yet).

## Hardware

- ESP32 DevKit, 30-pin (CP2102, USB-C)
- RFID-RC522 module (13.56 MHz, MIFARE cards and fobs)
- DS3231 RTC module with a CR2032 coin cell
- 128x64 SSD1306 I2C OLED (0.96" or 1.3") at address 0x3C, with the 4-button keypad (K1-K4)
- Buzzer (active buzzer module, or a buzzer driven through a transistor)
- Relay: GPIO26 is reserved for a future door relay; the firmware does not drive it

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
| Keypad | K1..K4 | unknown, set in `config.h` | button to GND, read active-low |
| Relay | IN | GPIO26 | reserved, unused |

Button pins: trace each K1-K4 button on the OLED board to the ESP32 pin it
reaches and put the GPIO numbers in `config.h` (`BTN_K1_PIN` ...). Leave a
button at `-1` if it is not connected. The firmware uses `INPUT_PULLUP`, but
**GPIO34, 35, 36 and 39 have no internal pull-ups**: a button on one of those
pins needs an external 10 kΩ resistor from the pin to 3.3 V. Only K1 does
anything today (info screen).

## Software setup (Arduino IDE 1.8.19, Windows)

1. **Board support.** File -> Preferences -> Additional Boards Manager URLs:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`.
   Tools -> Board -> Boards Manager -> install **esp32 by Espressif Systems**, a
   **2.0.x** release (2.0.17 is the last 2.x). Core 3.x is not tested.
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

   `WiFi`, `WiFiClientSecure`, `HTTPClient`, `SPI` and `Wire` come with the
   ESP32 core. ArduinoJson 7 still compiles this sketch with deprecation
   warnings, but 6.21.x is what it was written against.

## Register the reader and get its key

1. In the web console go to **Settings -> Check-in devices -> Register**.
2. Pick the branch the reader is installed at and give it a name.
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
every 24 hours. The RTC holds local time; the `ts` sent to the server is
converted back to real Unix seconds.

| State | OLED | Beep |
|---|---|---|
| Boot | `BOOT`, then `WIFI` + SSID + progress dots (up to 20 s) | one short beep when ready |
| Idle | label + WiFi state, large clock, date, `TAP CARD` | - |
| Checking | `CHECKING` + card UID | - |
| Allowed | name, member code, `ALLOW`, `WELCOME` (or `ALREADY IN` on a second tap today), `Expires in N days` when expiring | 1 short |
| Denied: dues | `DENY`, `PAY DUES Rs X` (X = `due_paisa` / 100) | 3 short |
| Denied: expired / frozen / not started / no membership / left | `DENY`, `EXPIRED` / `FROZEN` / `NOT STARTED YET` / `NO MEMBERSHIP` / `NOT A MEMBER` | 3 short |
| Unknown card | `DENY`, `UNKNOWN CARD`, `Ask desk to assign` | 3 short |
| Bad read | `DENY`, `BAD READ`, `Tap again` | 3 short |
| Key unknown (HTTP 401) | `SETUP`, `DEVICE KEY UNKNOWN` | 1 long |
| Reader disabled (HTTP 403) | `DISABLED`, `READER DISABLED` | 1 long |
| Offline (no WiFi, timeout, HTTP 5xx/other) | `OFFLINE`, `NOT RECORDED`, cause | 1 long |
| K1 pressed (idle) | info for 5 s: label, IP, RSSI, RTC date/time, firmware version | - |

Results stay on screen for 3 seconds. The same card is ignored for 3 seconds
after its result so a lingering card does not double-post (the server also
records at most one visit per member per day).

**Enrolling a new card:** a member taps an unassigned card, the reader shows
`UNKNOWN CARD`, and the scan appears in the console's unassigned-scans list.
Staff assign it from the member's profile. The next tap is allowed.

## Security

- **`setInsecure()`**: the reader uses HTTPS but does **not** verify the
  server certificate. Traffic is encrypted, but someone who can intercept the
  gym's WiFi (a rogue access point, ARP spoofing) could impersonate the
  server and read the device key. The key only lets a holder ask "may this
  card in?" for that branch and create check-ins for cards that are assigned,
  but treat a leaked key as compromised. A follow-up is to pin the CA with the
  ESP32 certificate bundle.
- **Rotating a key**: in the console open **Settings -> Check-in devices**, pick
  the reader, choose **Rotate key**, copy the new key, update `DEVICE_KEY` in
  `config.h` and re-flash. The old key stops working immediately, so the reader
  shows `DEVICE KEY UNKNOWN` until it is re-flashed.
- **Disabling a reader** (lost or stolen) in the console makes it show
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
| `OFFLINE` + `No WiFi` | Wrong SSID/password or a 5 GHz-only network. The reader retries every 15 s. |
| `OFFLINE` + `No server reply` / `HTTP 5xx` | Internet down or a server error. Check Serial for the HTTP error. |
| `DEVICE KEY UNKNOWN` | Key mistyped, rotated, or the reader was registered on another project. Re-copy or rotate. |
| Buzzer always on / never on | Flip `BUZZER_ACTIVE_HIGH`. A *passive* buzzer only clicks with this firmware; use an active buzzer module. |
| K1 info screen pops up by itself | The button pin is floating: wrong pin, or GPIO34-39 without an external pull-up. |
| Upload fails "Failed to connect" | Hold BOOT while the IDE says `Connecting...`. Disconnect anything on GPIO0/2/12/15 during upload. |
