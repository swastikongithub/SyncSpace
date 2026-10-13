// A Spline scene of a laptop, a phone and the server, authored in the Spline editor and loaded
// with Spline's official React component. The page and the scene talk through a small contract
// (docs/landing-page-design.md, "Spline scene contract"):
//   object Phone   a mouseDown event authored on it toggles the phone between online and offline
// Every interaction also has an HTML control, because a canvas is not keyboard-accessible.
import Spline from '@splinetool/react-spline';
import { useCallback, useEffect, useRef, useState } from 'react';

export default function SplineDesk({ scene }) {
  const app = useRef(null);
  const frame = useRef(null);
  const [ready, setReady] = useState(false);
  const [phoneOffline, setPhoneOffline] = useState(false);

  // Pause the scene's rendering while it is off screen.
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (!app.current) return;
      if (entries.some((entry) => entry.isIntersecting)) app.current.play();
      else app.current.stop();
    });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);

  const onLoad = useCallback((application) => {
    app.current = application;
    setReady(true);
  }, []);

  const onSplineMouseDown = useCallback((event) => {
    if (event.target?.name === 'Phone') setPhoneOffline((offline) => !offline);
  }, []);

  const togglePhone = () => {
    // Plays the transition authored on the Phone object, exactly as a click on it would.
    app.current?.emitEvent('mouseDown', 'Phone');
  };

  return (
    <div ref={frame} className="ss-spline" data-scene-ready={ready}>
      <div className="ss-spline-canvas">
        <Spline scene={scene} onLoad={onLoad} onSplineMouseDown={onSplineMouseDown} aria-hidden="true" />
      </div>
      <div className="ss-spline-controls">
        <button type="button" className="ss-stage-control" disabled={!ready} aria-pressed={phoneOffline} onClick={togglePhone}>
          {phoneOffline ? 'Reconnect the phone' : 'Take the phone offline'}
        </button>
        <p aria-live="polite">{phoneOffline ? 'The phone is offline. Its edits stay on it until it reconnects.' : 'Both devices are online.'}</p>
        <p className="ss-spline-credit">
          <a href="https://spline.design" target="_blank" rel="noopener noreferrer">
            Made with Spline
          </a>
        </p>
      </div>
    </div>
  );
}
