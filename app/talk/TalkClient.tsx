'use client';

import { Room, RoomEvent, Track } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';

type Phase = 'idle' | 'connecting' | 'live' | 'ended' | 'error';

export default function TalkClient() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const room = useRef<Room | null>(null);
  const audioHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const end = useCallback(async () => {
    await room.current?.disconnect();
    room.current = null;
    setPhase('ended');
  }, []);

  const start = useCallback(async () => {
    setPhase('connecting');
    setMessage('');
    setSeconds(0);
    try {
      const res = await fetch('/api/talk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: lang }) });
      const data = (await res.json()) as { token?: string; url?: string; error?: string };
      if (!res.ok || !data.token || !data.url) throw new Error(data.error ?? 'Could not start the call.');

      const r = new Room({ adaptiveStream: true, dynacast: true });
      room.current = r;
      r.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.autoplay = true;
          audioHost.current?.appendChild(el);
        }
      });
      r.on(RoomEvent.Disconnected, () => setPhase((p) => (p === 'error' ? p : 'ended')));
      await r.connect(data.url, data.token);
      await r.localParticipant.setMicrophoneEnabled(true);
      setPhase('live');
    } catch (e) {
      const msg = (e as Error).message;
      setMessage(/permission|denied|NotAllowed/i.test(msg) ? 'Microphone access was blocked. Allow it in the browser address bar and try again.' : msg);
      setPhase('error');
      await room.current?.disconnect();
      room.current = null;
    }
  }, [lang]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <main className="page" style={{ maxWidth: 520, paddingTop: 64 }}>
      <h1 style={{ fontSize: 26, margin: '0 0 6px' }}>Talk to Aangan Studio</h1>
      <p className="muted" style={{ marginTop: 0, lineHeight: 1.6 }}>
        Our virtual assistant answers any time of day. Tell it about your project and it will pass your details to a designer.
        This call is recorded so our designers have your details. It will ask to use your microphone.
      </p>

      <div className="card" style={{ marginTop: 20, textAlign: 'center' }} aria-live="polite">
        {phase === 'idle' || phase === 'ended' || phase === 'error' ? (
          <>
            <label className="muted" style={{ fontSize: 13 }} htmlFor="lang">Language </label>
            <select id="lang" value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'hi')} className="input" style={{ padding: '6px 10px', marginRight: 8 }}>
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
            </select>
            <button className="button" onClick={start} style={{ marginTop: 12 }}>
              {phase === 'ended' ? 'Call again' : 'Start call'}
            </button>
          </>
        ) : null}
        {phase === 'connecting' ? <p>Connecting…</p> : null}
        {phase === 'live' ? (
          <>
            <p style={{ fontSize: 28, margin: '4px 0', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: 'var(--good)' }}>● </span>
              {mm}:{ss}
            </p>
            <p className="muted" style={{ marginTop: 0 }}>Live — speak whenever you like.</p>
            <button className="button" onClick={end} style={{ background: 'var(--critical)' }}>End call</button>
          </>
        ) : null}
        {phase === 'ended' ? <p className="muted">Call ended. Thank you for calling Aangan Studio.</p> : null}
        {message ? (
          <p role="alert" style={{ color: 'var(--critical)' }}>
            ⚠ {message}
          </p>
        ) : null}
      </div>
      <div ref={audioHost} aria-hidden="true" />
      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
        The assistant can&apos;t give prices — a designer will walk you through them at the consultation.
      </p>
    </main>
  );
}
