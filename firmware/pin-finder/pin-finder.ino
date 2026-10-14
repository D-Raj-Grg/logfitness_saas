// pin-finder.ino -- throwaway diagnostic for the Lord of Gyms RFID reader.
//
// Press each keypad button (K1..K4) one at a time and read the Serial monitor
// (115200 baud): it prints which GPIO went LOW, or, for the input-only/ADC pins,
// which pin's analog reading jumped. Use the result to fill BTN_K1_PIN ..
// BTN_K4_PIN in config.h. If all four keys show up on ONE ADC pin with
// different values, the keypad is a resistor ladder (see README).
//
// Pins already used by the reader (RC522, I2C, buzzer, relay) are not scanned:
// 5, 18, 19, 21, 22, 23, 25, 26, 27. Strapping pins 0 and 12 are skipped too.

#include <Arduino.h>

// Digital candidates, read with the internal pull-up (button to GND = LOW).
const uint8_t DIGITAL_PINS[] = { 2, 4, 13, 14, 15, 16, 17, 32, 33 };
// Input-only pins: no internal pull-up, so judged by analog level changes.
const uint8_t ANALOG_PINS[] = { 34, 35, 36, 39 };

const uint8_t N_DIGITAL = sizeof(DIGITAL_PINS) / sizeof(DIGITAL_PINS[0]);
const uint8_t N_ANALOG = sizeof(ANALOG_PINS) / sizeof(ANALOG_PINS[0]);

bool lastLow[sizeof(DIGITAL_PINS)];
int baseline[sizeof(ANALOG_PINS)];
bool analogActive[sizeof(ANALOG_PINS)];

int readAvg(uint8_t pin) {
  long sum = 0;
  for (int i = 0; i < 8; i++) sum += analogRead(pin);
  return (int)(sum / 8);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("[pin-finder] press K1, K2, K3, K4 one at a time");

  for (uint8_t i = 0; i < N_DIGITAL; i++) {
    pinMode(DIGITAL_PINS[i], INPUT_PULLUP);
    lastLow[i] = false;
  }
  for (uint8_t i = 0; i < N_ANALOG; i++) {
    pinMode(ANALOG_PINS[i], INPUT);
    baseline[i] = readAvg(ANALOG_PINS[i]);
    analogActive[i] = false;
    Serial.printf("[analog] GPIO%u idle level %d\n", ANALOG_PINS[i], baseline[i]);
  }
}

void loop() {
  for (uint8_t i = 0; i < N_DIGITAL; i++) {
    bool low = digitalRead(DIGITAL_PINS[i]) == LOW;
    if (low != lastLow[i]) {
      delay(15);  // debounce
      low = digitalRead(DIGITAL_PINS[i]) == LOW;
      if (low != lastLow[i]) {
        lastLow[i] = low;
        Serial.printf("[digital] GPIO%u %s\n", DIGITAL_PINS[i], low ? "PRESSED (LOW)" : "released");
      }
    }
  }

  for (uint8_t i = 0; i < N_ANALOG; i++) {
    int v = readAvg(ANALOG_PINS[i]);
    bool moved = abs(v - baseline[i]) > 600;
    if (moved != analogActive[i]) {
      delay(15);
      v = readAvg(ANALOG_PINS[i]);
      moved = abs(v - baseline[i]) > 600;
      if (moved != analogActive[i]) {
        analogActive[i] = moved;
        Serial.printf("[analog] GPIO%u %s (level %d, idle %d)\n", ANALOG_PINS[i],
                      moved ? "CHANGED" : "back to idle", v, baseline[i]);
      }
    }
  }
  delay(5);
}
