#!/usr/bin/env bash
# Baixa as 7 trilhas CC0 do Knight Quest com o nome certo em assets/music/.
# Uso: cd assets/music && bash download.sh
# Todas as tracks: CC0 (domínio público), OpenGameArt.org.
# - title/village/forest/dungeon/boss/victory/gameover conforme audio.ts espera.

set -euo pipefail
cd "$(dirname "$0")"

declare -a JOBS=(
  "title.mp3|https://opengameart.org/sites/default/files/Rising_Moon_0.mp3"                # Fantasy: Rising Moon — RandomMind
  "village.mp3|https://opengameart.org/sites/default/files/The_Bards_Tale.mp3"             # Medieval: The Bard's Tale — RandomMind
  "forest.mp3|https://opengameart.org/sites/default/files/GameMusic_ForestTheme_24_0.mp3"  # Dark Forest Theme — cynicmusic
  "dungeon.mp3|https://opengameart.org/sites/default/files/dungeon002_0.ogg"               # Dungeon Ambience — yd (baixa .ogg, converte pra mp3 se ffmpeg existir)
  "boss.mp3|https://opengameart.org/sites/default/files/battle_8.mp3"                       # Medieval: Battle — RandomMind
  "victory.mp3|https://opengameart.org/sites/default/files/victory_0.mp3"                   # Medieval: Victory Theme — RandomMind
  "gameover.mp3|https://opengameart.org/sites/default/files/defeat_0.mp3"                   # Medieval: Defeat Theme — RandomMind
)

for pair in "${JOBS[@]}"; do
  out="${pair%%|*}"
  url="${pair##*|}"
  if [[ -f "$out" ]]; then
    echo "skip: $out já existe"
    continue
  fi
  echo "→ $out"
  if [[ "$url" == *.ogg ]]; then
    tmp="$(basename "$url")"
    curl -fSL -A "Mozilla/5.0" -o "$tmp" "$url"
    if command -v ffmpeg >/dev/null 2>&1; then
      ffmpeg -y -loglevel error -i "$tmp" -codec:a libmp3lame -b:a 128k "$out"
      rm -f "$tmp"
    else
      echo "  ⚠️  ffmpeg não encontrado — deixando $tmp; renomeie o campo em audio.ts (.ogg) ou instale ffmpeg."
      mv "$tmp" "${out%.mp3}.ogg"
    fi
  else
    curl -fSL -A "Mozilla/5.0" -o "$out" "$url"
  fi
done

echo
echo "Pronto. Arquivos em assets/music/:"
ls -la *.mp3 2>/dev/null || true
echo
echo "Recarregue o jogo (Cmd+Shift+R) — o audio.ts detecta os MP3s automaticamente."
