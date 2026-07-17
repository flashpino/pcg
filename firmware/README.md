# Firmware — ESP32 CYD + DHT22

## As duas variantes de tela (cores invertidas)

Existem duas revisões do CYD (ESP32-2432S028R) no mercado com painéis diferentes.
Uma precisa da flag de inversão de cor, a outra não — na tela errada, as cores
aparecem invertidas (tipo negativo de foto).

O `platformio.ini` tem um environment para cada uma; **não é preciso editar código**:

| Environment      | Para qual tela                                    |
|------------------|---------------------------------------------------|
| `esp32dev`       | Telas originais do projeto (`TFT_INVERSION_ON=1`) |
| `esp32dev-noinv` | Telas novas, que ficavam com cores invertidas     |

Se numa tela as cores não estiverem invertidas mas o **vermelho/azul estiverem
trocados**, o ajuste é `TFT_RGB_ORDER=0` no environment dela (comentado no
`platformio.ini`).

## Upload por USB

Pré-requisito (uma vez só): PlatformIO CLI instalado via Python:

```powershell
py -m pip install --user platformio
```

Gravação — conecte a tela pelo cabo micro-USB e rode dentro de `firmware/`:

```powershell
# telas originais:
py -m platformio run -e esp32dev -t upload

# telas novas (cores invertidas na variante padrão):
py -m platformio run -e esp32dev-noinv -t upload
```

A porta COM é detectada automaticamente. Se nenhuma COM nova aparecer ao plugar
o cabo, instale o driver **CH340** (chip serial usado no CYD).

Para só compilar sem gravar: `py -m platformio run` (compila as duas variantes).

> O comando `pio` puro não funciona por padrão porque o Scripts do Python não
> está no PATH. Ou use sempre `py -m platformio`, ou adicione
> `%APPDATA%\Python\Python314\Scripts` ao PATH do Windows.

## Atualização OTA (pelo painel)

Os binários compilados ficam em:

```
firmware/.pio/build/esp32dev/firmware.bin
firmware/.pio/build/esp32dev-noinv/firmware.bin
```

Como as duas variantes reportam a **mesma versão** (`config.h`), para OTA com
telas misturadas cadastre os dois `.bin` no painel (aba **Firmware**) com nomes
de versão distintos — ex. `1.1.6` e `1.1.6-noinv` — e defina o **Firmware
alvo** de cada sensor na aba **Sensores** conforme a tela dele. Sensor com alvo
vazio recebe a versão mais recente cadastrada (latest), então com telas
misturadas **sempre** fixe o alvo por sensor.

**Cuidado:** gravar a variante errada (USB ou OTA) não quebra o aparelho — só
inverte as cores. Basta regravar com a variante certa.

## Notas rápidas

- Versão do firmware: `src/config.h` (`FIRMWARE_VERSION`). Bump a cada release.
- DHT22 no GPIO 27 (conector CN1). Pinout completo comentado no `platformio.ini`.
- O "uptime" do painel **não** é o uptime do ESP32 — é o tempo desde a última
  queda de conectividade detectada pelo servidor. Reinícios rápidos (OTA, ~s)
  não derrubam a conectividade e por isso não zeram o contador.
