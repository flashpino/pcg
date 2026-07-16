#pragma once
#include <Arduino.h>
#include <IPAddress.h>

// Camada NVS (Preferences) — WiFi, identidade do device e IP estático.
// device_name/PIN/calibração de touch são consumidos pela Task 13 (menu na tela).
namespace storage {

struct WifiCredentials {
  String ssid;
  String password;
};

struct StaticIpConfig {
  bool enabled = false;
  IPAddress ip, gateway, subnet, dns;
};

void begin();

bool hasWifiCredentials();
WifiCredentials loadWifiCredentials();
void saveWifiCredentials(const String& ssid, const String& password);

bool hasDeviceToken();
String loadDeviceToken();
void saveDeviceToken(const String& token);

// Sem UI de nome ainda (Task 13) — default derivado do MAC até o usuário trocar.
String loadDeviceName();
void saveDeviceName(const String& name);

StaticIpConfig loadStaticIp();
void saveStaticIp(const StaticIpConfig& cfg);

String loadPin();  // default "1234" se nunca foi trocado
void savePin(const String& pin);

// Calibração de 4 pontos simplificada: min/max por eixo (sem correção de rotação/skew —
// suficiente pro touch resistivo do CYD, que não tem desalinhamento angular perceptível).
struct TouchCalibration {
  bool valid = false;
  uint16_t xMin = 0, xMax = 4095, yMin = 0, yMax = 4095;
};
bool hasTouchCalibration();
TouchCalibration loadTouchCalibration();
void saveTouchCalibration(const TouchCalibration& cal);

}  // namespace storage
