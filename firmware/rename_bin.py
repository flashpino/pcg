# Pós-build do PlatformIO: copia o firmware.bin de cada environment para dist/
# com nome autoexplicativo (pcg-<versão>-<env>.bin), pra não confundir os dois
# binários na hora de cadastrar OTA no painel.
import os
import re
import shutil

Import("env")  # noqa: F821 - injetado pelo PlatformIO


def after_build(source, target, env):
    proj = env["PROJECT_DIR"]
    version = "dev"
    with open(os.path.join(proj, "src", "config.h"), encoding="utf-8") as f:
        m = re.search(r'#define\s+FW_VERSION\s+"([^"]+)"', f.read())
        if m:
            version = m.group(1)
    dist = os.path.join(proj, "dist")
    os.makedirs(dist, exist_ok=True)
    dst = os.path.join(dist, f"pcg-{version}-{env['PIOENV']}.bin")
    shutil.copy(str(target[0]), dst)
    print(f"Binario copiado para: {dst}")


env.AddPostAction("$BUILD_DIR/firmware.bin", after_build)  # noqa: F821
