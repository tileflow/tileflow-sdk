import os
from pathlib import Path

path = Path(os.environ["ANDROID_AVD_HOME"]) / "test.avd/config.ini"
settings = {"hw.lcd.width": "360", "hw.lcd.height": "800", "hw.lcd.density": "140"}
lines = path.read_text().splitlines()
lines = [line for line in lines if line.split("=", 1)[0].strip() not in settings]
path.write_text("\n".join(lines + [f"{key}={value}" for key, value in settings.items()]) + "\n")
print("Physical AVD display:", settings)
