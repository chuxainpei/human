"""Compose the demo recording: browser video + the exact TTS audio the page played, placed at the page's own
audio 'playing' timestamps (and cut at 'cancel'/'pause'). Usage: python3 make_demo_video.py <run_dir> <out.mp4>
Headless Chromium cannot record its audio output, so this re-attaches the real audio clips by their playback events."""
import json, pathlib, subprocess, sys

run = pathlib.Path(sys.argv[1]); out = sys.argv[2]
meta = json.load(open(run / 'run.json')); log = json.load(open(run / 'speech-log.json'))
t0 = meta['videoStartWall']
pool = {}
for t in meta['tts']: pool.setdefault(t['text'], []).append(run / 'tts' / t['file'])
segs = []
for i, e in enumerate(log):
    if e['type'] != 'start' or not e.get('detail'): continue
    files = pool.get(e['detail']) or []
    if not files: continue
    f = files.pop(0)
    end = next((x for x in log[i + 1:] if x['type'] in ('end', 'cancel', 'error')), None)
    start_ms = max(0, int(e['wall'] - t0))
    dur = (end['wall'] - e['wall']) / 1000 if end else None
    segs.append((f, start_ms, dur))
print('segments', len(segs))
inputs = ['-i', str(run / 'video.webm')]
filt = []
for k, (f, ms, dur) in enumerate(segs):
    inputs += ['-i', str(f)]
    trim = f'atrim=0:{dur:.3f},' if dur else ''
    filt.append(f'[{k+1}:a]{trim}adelay={ms}|{ms},apad=pad_dur=0[a{k}]')
mix = ''.join(f'[a{k}]' for k in range(len(segs))) + f'amix=inputs={len(segs)}:normalize=0:duration=longest[aout]'
note = "drawtext=fontfile=/home/sandbox/.fonts/NotoSansSC.otf:text='真实浏览器录屏 · DeepSeek 实时生成 · 音轨为页面实际播放的服务器语音（按播放事件对齐）':x=20:y=h-34:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=8:enable='lt(t,12)'"
cmd = ['ffmpeg', '-y', *inputs, '-filter_complex', ';'.join(filt + [mix]) + f';[0:v]{note}[v]', '-map', '[v]', '-map', '[aout]',
       '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', out]
subprocess.run(cmd, check=True, capture_output=True)
print(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration,size', '-of', 'default=nw=1', out], capture_output=True, text=True).stdout)
