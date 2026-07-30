# proatus

## Firmware (ESP32 CYD)

PlatformIO **não** está no PATH como `pio` — o Scripts do Python não foi
adicionado ao PATH do Windows. Use sempre `py -m platformio`, nunca `pio`
puro (ele falha com "não é reconhecido").

Compilar (dentro de `firmware/`):

```powershell
py -m platformio run
```

Gravar por USB, upload OTA, as duas variantes de tela (cores invertidas) e
outras notas: ver [firmware/README.md](firmware/README.md).

**Sempre que gerar um novo firmware (qualquer mudança em `firmware/src/`),
incrementar `FW_VERSION` em `firmware/src/config.h` antes de compilar.** É o
que aparece no campo `fw` do ingest e na tela de info de rede do device —
sem isso não dá pra saber no painel/OTA quais dispositivos já têm o firmware
novo.

## Server / Web

Node/TypeScript padrão — `npm run build` / `npm test` dentro de `server/` e
`web/` respectivamente (sem gotcha de PATH).
