'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/components/ui';

export type OrenLogoState = 'idle' | 'thinking' | 'processing' | 'success' | 'alert';

interface OrenLogoProps {
  state?: OrenLogoState;
  size?: number;
  className?: string;
  interactive?: boolean;
  attentionTargetId?: string;
}

/** Shell paths fitted from public/oren-logo.png (see scripts/validate-oren-logo.mjs). */
const SHELL_OUTER =
  'M 51.37 11.59 C 53.16 11.61 54.93 11.66 56.74 11.82 C 58.54 11.97 60.39 12.18 62.21 12.5 C 64.04 12.82 65.91 13.18 67.69 13.76 C 69.48 14.33 71.29 15.01 72.95 15.92 C 74.6 16.84 76.18 17.98 77.63 19.24 C 79.07 20.49 80.46 21.94 81.62 23.46 C 82.78 24.98 83.69 26.69 84.59 28.37 C 85.48 30.04 86.13 31.79 86.99 33.5 C 87.84 35.22 88.57 36.93 89.73 38.64 C 90.89 40.35 92.43 41.88 93.95 43.78 C 95.47 45.68 97.89 47.85 98.86 50.06 C 99.83 52.26 100.1 54.79 99.77 57.02 C 99.45 59.25 98.27 61.49 96.92 63.41 C 95.57 65.33 93.3 66.93 91.67 68.55 C 90.03 70.17 88.51 71.56 87.1 73.12 C 85.69 74.68 84.53 76.35 83.22 77.91 C 81.91 79.47 80.73 81.15 79.22 82.48 C 77.72 83.81 76.01 85.05 74.2 85.9 C 72.39 86.76 70.34 87.23 68.38 87.61 C 66.42 87.99 64.38 88.07 62.44 88.18 C 60.5 88.3 58.58 88.26 56.74 88.3 C 54.89 88.34 53.16 88.39 51.37 88.41 C 49.58 88.43 47.83 88.43 46 88.41 C 44.18 88.39 42.29 88.38 40.41 88.3 C 38.53 88.22 36.66 88.17 34.7 87.96 C 32.74 87.75 30.59 87.61 28.65 87.04 C 26.71 86.47 24.73 85.65 23.06 84.53 C 21.39 83.41 20 81.79 18.61 80.31 C 17.22 78.82 16.02 77.21 14.73 75.63 C 13.43 74.05 12.39 72.41 10.84 70.83 C 9.3 69.25 7.08 67.9 5.48 66.15 C 3.88 64.4 2.15 62.44 1.26 60.33 C 0.36 58.22 -0.23 55.75 0.11 53.48 C 0.46 51.22 1.94 48.8 3.31 46.75 C 4.68 44.69 6.94 42.94 8.33 41.15 C 9.72 39.36 10.67 37.73 11.64 36.02 C 12.61 34.3 13.28 32.55 14.16 30.88 C 15.03 29.2 15.85 27.55 16.89 25.97 C 17.94 24.39 19.12 22.77 20.43 21.4 C 21.75 20.03 23.21 18.8 24.77 17.75 C 26.33 16.7 28.06 15.87 29.79 15.13 C 31.53 14.38 33.35 13.77 35.16 13.3 C 36.97 12.82 38.83 12.54 40.64 12.27 C 42.45 12.01 44.22 11.82 46 11.7 C 47.79 11.59 49.58 11.57 51.37 11.59 Z';

const SHELL_INNER =
  'M 51.13 18.18 C 52.62 18.19 54.08 18.22 55.59 18.31 C 57.09 18.41 58.64 18.55 60.17 18.78 C 61.71 19 63.28 19.25 64.8 19.69 C 66.31 20.12 67.86 20.66 69.26 21.4 C 70.66 22.14 72 23.1 73.22 24.15 C 74.43 25.2 75.6 26.42 76.57 27.7 C 77.53 28.99 78.26 30.45 78.99 31.87 C 79.73 33.28 80.23 34.76 80.96 36.19 C 81.69 37.62 82.3 39.04 83.38 40.46 C 84.46 41.87 85.94 43.1 87.41 44.7 C 88.89 46.3 91.29 48.15 92.26 50.05 C 93.23 51.95 93.52 54.17 93.24 56.1 C 92.96 58.02 91.84 59.97 90.57 61.6 C 89.31 63.23 87.15 64.53 85.64 65.87 C 84.13 67.2 82.74 68.33 81.5 69.63 C 80.25 70.93 79.28 72.34 78.17 73.67 C 77.05 74.99 76.08 76.44 74.81 77.57 C 73.53 78.7 72.07 79.74 70.51 80.43 C 68.96 81.11 67.17 81.44 65.48 81.68 C 63.8 81.93 62.05 81.89 60.4 81.91 C 58.75 81.93 57.14 81.81 55.59 81.8 C 54.05 81.78 52.62 81.81 51.13 81.82 C 49.65 81.83 48.21 81.84 46.69 81.85 C 45.17 81.86 43.6 81.9 42.01 81.9 C 40.43 81.89 38.85 81.93 37.17 81.84 C 35.49 81.74 33.62 81.74 31.95 81.32 C 30.27 80.91 28.55 80.26 27.12 79.33 C 25.69 78.39 24.53 76.99 23.36 75.72 C 22.18 74.46 21.18 73.08 20.07 71.75 C 18.95 70.42 18.07 69.04 16.67 67.73 C 15.27 66.43 13.18 65.36 11.68 63.9 C 10.19 62.44 8.54 60.78 7.71 58.96 C 6.88 57.15 6.33 54.98 6.7 53.02 C 7.06 51.06 8.55 48.96 9.89 47.21 C 11.24 45.46 13.46 44.01 14.79 42.52 C 16.11 41.04 16.98 39.7 17.84 38.28 C 18.71 36.85 19.25 35.39 19.98 33.99 C 20.71 32.58 21.37 31.18 22.24 29.85 C 23.1 28.52 24.08 27.14 25.18 25.99 C 26.28 24.84 27.52 23.81 28.84 22.95 C 30.16 22.09 31.64 21.42 33.1 20.84 C 34.57 20.25 36.11 19.78 37.63 19.42 C 39.15 19.06 40.72 18.87 42.23 18.68 C 43.74 18.49 45.21 18.35 46.69 18.27 C 48.17 18.18 49.65 18.17 51.13 18.18 Z';

const SHELL_RING = `${SHELL_OUTER} ${SHELL_INNER}`;

const EYE_LEFT = { cx: 40, cy: 52, rx: 4.2, ry: 9.5 };
const EYE_RIGHT = { cx: 60, cy: 52, rx: 4.2, ry: 9.5 };

const HAPPY_EYE_LEFT = 'M 35.5 52 Q 40 46.5 44.5 52';
const HAPPY_EYE_RIGHT = 'M 55.5 52 Q 60 46.5 64.5 52';

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return reduced;
}

export function OrenLogo({
  state = 'idle',
  size = 120,
  className,
  interactive = false,
  attentionTargetId,
}: OrenLogoProps) {
  const uid = useId().replace(/:/g, '');
  const reducedMotion = usePrefersReducedMotion();
  const [blinking, setBlinking] = useState(false);
  const logoRef = useRef<HTMLDivElement>(null);
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gestureFrame = useRef<number | undefined>(undefined);
  const gestureTarget = useRef({ x: 0, y: 0, kickX: 0, kickY: 0, engaged: false });
  const gestureCurrent = useRef({ shellX: 0, shellY: 0, eyeX: 0, eyeY: 0, energy: 0 });
  const lastPointer = useRef({ x: 0, y: 0, time: 0 });
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (state !== 'idle' || reducedMotion) {
      const resetBlink = window.setTimeout(() => setBlinking(false), 0);
      return () => window.clearTimeout(resetBlink);
    }

    const scheduleBlink = () => {
      const delay = 2600 + Math.random() * 5200;
      blinkTimer.current = setTimeout(() => {
        setBlinking(true);
        blinkTimer.current = setTimeout(() => {
          setBlinking(false);
          scheduleBlink();
        }, 130);
      }, delay);
    };

    scheduleBlink();
    return () => {
      if (blinkTimer.current) clearTimeout(blinkTimer.current);
    };
  }, [reducedMotion, state]);

  useEffect(() => {
    const logo = logoRef.current;
    if (!logo) return;

    if (!interactive || reducedMotion || state !== 'idle') {
      logo.style.setProperty('--oren-look-x', '0px');
      logo.style.setProperty('--oren-look-y', '0px');
      logo.style.setProperty('--oren-eye-x', '0px');
      logo.style.setProperty('--oren-eye-y', '0px');
      logo.style.setProperty('--oren-tilt', '0deg');
      logo.style.setProperty('--oren-energy', '0');
      logo.style.setProperty('--oren-light-x', '0px');
      logo.style.setProperty('--oren-light-y', '0px');
      logo.dataset.engaged = 'false';
      logo.dataset.attention = 'false';
      logo.dataset.pressed = 'false';
      gestureCurrent.current = { shellX: 0, shellY: 0, eyeX: 0, eyeY: 0, energy: 0 };
      return;
    }

    let previousFrameTime: number | undefined;
    let pendingPointer: { x: number; y: number } | undefined;

    const updateGesture = (time: number) => {
      // Coalesce high-frequency pointer events before the frame's style writes.
      if (pendingPointer) {
        const point = pendingPointer;
        pendingPointer = undefined;
        setTargetFromPoint(point.x, point.y, true);
      }
      const elapsed = previousFrameTime === undefined ? 1000 / 60 : Math.min(64, time - previousFrameTime);
      previousFrameTime = time;
      const frames = elapsed / (1000 / 60);
      const shellEase = 1 - Math.pow(0.91, frames);
      const eyeEase = 1 - Math.pow(0.8, frames);
      const energyEase = 1 - Math.pow(0.89, frames);
      const target = gestureTarget.current;
      const current = gestureCurrent.current;
      const shellTargetX = target.x - target.kickX * 0.22;
      const shellTargetY = target.y - target.kickY * 0.16;
      const targetEnergy = target.engaged ? Math.min(1, Math.hypot(target.x, target.y) + 0.16) : 0;

      current.shellX += (shellTargetX - current.shellX) * shellEase;
      current.shellY += (shellTargetY - current.shellY) * shellEase;
      current.eyeX += (target.x - current.eyeX) * eyeEase;
      current.eyeY += (target.y - current.eyeY) * eyeEase;
      current.energy += (targetEnergy - current.energy) * energyEase;
      target.kickX *= Math.pow(0.84, frames);
      target.kickY *= Math.pow(0.84, frames);

      logo.style.setProperty('--oren-look-x', `${current.shellX * 4.8}px`);
      logo.style.setProperty('--oren-look-y', `${current.shellY * 3.6}px`);
      logo.style.setProperty('--oren-eye-x', `${current.eyeX * 3.15}px`);
      logo.style.setProperty('--oren-eye-y', `${current.eyeY * 2.15}px`);
      logo.style.setProperty('--oren-tilt', `${current.shellX * 3.4}deg`);
      logo.style.setProperty('--oren-energy', current.energy.toFixed(3));
      logo.style.setProperty('--oren-light-x', `${current.eyeX * 2.4}px`);
      logo.style.setProperty('--oren-light-y', `${current.eyeY * 1.8}px`);
      logo.dataset.engaged = String(target.engaged || current.energy > 0.035);

      const unsettled =
        Math.abs(shellTargetX - current.shellX) > 0.002 ||
        Math.abs(shellTargetY - current.shellY) > 0.002 ||
        Math.abs(target.x - current.eyeX) > 0.002 ||
        Math.abs(target.y - current.eyeY) > 0.002 ||
        Math.abs(targetEnergy - current.energy) > 0.002 ||
        Math.abs(target.kickX) > 0.002 ||
        Math.abs(target.kickY) > 0.002;

      if (unsettled) {
        gestureFrame.current = window.requestAnimationFrame(updateGesture);
      } else {
        gestureFrame.current = undefined;
        previousFrameTime = undefined;
      }
    };

    const startGesture = () => {
      if (gestureFrame.current === undefined) {
        gestureFrame.current = window.requestAnimationFrame(updateGesture);
      }
    };

    const setTargetFromPoint = (clientX: number, clientY: number, withVelocity = false) => {
      const bounds = logo.getBoundingClientRect();
      const deltaX = clientX - (bounds.left + bounds.width / 2);
      const deltaY = clientY - (bounds.top + bounds.height / 2);
      const distance = Math.hypot(deltaX, deltaY);
      const directionX = distance > 0 ? deltaX / distance : 0;
      const directionY = distance > 0 ? deltaY / distance : 0;
      const closeRamp = Math.min(1, distance / Math.max(54, bounds.width * 0.55));
      const farProgress = Math.max(0, Math.min(1, (distance - 420) / 360));
      const farFalloff = 1 - farProgress * farProgress * (3 - 2 * farProgress);
      const strength = closeRamp * farFalloff;

      let kickX = 0;
      let kickY = 0;
      const now = performance.now();
      if (withVelocity && lastPointer.current.time > 0) {
        const elapsed = Math.max(8, now - lastPointer.current.time);
        kickX = Math.max(-0.7, Math.min(0.7, ((clientX - lastPointer.current.x) / elapsed) * 0.34));
        kickY = Math.max(-0.7, Math.min(0.7, ((clientY - lastPointer.current.y) / elapsed) * 0.34));
      }
      lastPointer.current = { x: clientX, y: clientY, time: now };

      gestureTarget.current = {
        x: directionX * strength,
        y: directionY * strength,
        kickX,
        kickY,
        engaged: strength > 0.04,
      };
      startGesture();
    };

    const releaseGesture = () => {
      pendingPointer = undefined;
      gestureTarget.current = { x: 0, y: 0, kickX: 0, kickY: 0, engaged: false };
      lastPointer.current.time = 0;
      logo.dataset.attention = 'false';
      startGesture();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pendingPointer = { x: event.clientX, y: event.clientY };
      startGesture();
    };

    const handlePointerOut = (event: PointerEvent) => {
      if (!event.relatedTarget) releaseGesture();
    };

    const handleTouchReaction = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      setTargetFromPoint(event.clientX, event.clientY);
      logo.dataset.pressed = 'true';
      setBlinking(true);
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
      reactionTimer.current = setTimeout(() => {
        logo.dataset.pressed = 'false';
        setBlinking(false);
        releaseGesture();
      }, 460);
    };

    const attentionTarget = attentionTargetId ? document.getElementById(attentionTargetId) : null;
    const focusAttentionTarget = () => {
      if (!attentionTarget) return;
      pendingPointer = undefined;
      const bounds = attentionTarget.getBoundingClientRect();
      logo.dataset.attention = 'true';
      setTargetFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    };
    const clearAttentionTarget = () => {
      logo.dataset.attention = 'false';
      releaseGesture();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerout', handlePointerOut);
    window.addEventListener('blur', releaseGesture);
    logo.addEventListener('pointerdown', handleTouchReaction, { passive: true });
    attentionTarget?.addEventListener('focus', focusAttentionTarget);
    attentionTarget?.addEventListener('blur', clearAttentionTarget);
    attentionTarget?.addEventListener('pointerenter', focusAttentionTarget);
    attentionTarget?.addEventListener('pointerleave', clearAttentionTarget);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerout', handlePointerOut);
      window.removeEventListener('blur', releaseGesture);
      logo.removeEventListener('pointerdown', handleTouchReaction);
      attentionTarget?.removeEventListener('focus', focusAttentionTarget);
      attentionTarget?.removeEventListener('blur', clearAttentionTarget);
      attentionTarget?.removeEventListener('pointerenter', focusAttentionTarget);
      attentionTarget?.removeEventListener('pointerleave', clearAttentionTarget);
      if (gestureFrame.current !== undefined) window.cancelAnimationFrame(gestureFrame.current);
      gestureFrame.current = undefined;
      if (reactionTimer.current) clearTimeout(reactionTimer.current);
    };
  }, [attentionTargetId, interactive, reducedMotion, state]);

  const shellGradient = `${uid}-shell-gradient`;
  const glowGradient = `${uid}-glow-gradient`;
  const shellGlow = `${uid}-shell-glow`;
  const eyeGlow = `${uid}-eye-glow`;
  const shellHighlight = `${uid}-shell-highlight`;

  return (
    <div
      aria-hidden
      className={cn('oren-logo', className)}
      data-blink={blinking ? 'true' : 'false'}
      data-interactive={interactive ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-state={state}
      ref={logoRef}
      style={{ width: size, height: size } as CSSProperties}
    >
      <svg aria-hidden fill="none" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient gradientUnits="userSpaceOnUse" id={shellGradient} x1="8" x2="92" y1="88" y2="12">
            <stop className="oren-logo__stop-blue" offset="0%" stopColor="#38bdf8" />
            <stop className="oren-logo__stop-mid" offset="48%" stopColor="#f8fbff" />
            <stop className="oren-logo__stop-violet" offset="100%" stopColor="#a855f7" />
          </linearGradient>

          <linearGradient gradientUnits="userSpaceOnUse" id={glowGradient} x1="0" x2="100" y1="50" y2="50">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.55" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0.55" />
          </linearGradient>

          <linearGradient gradientUnits="userSpaceOnUse" id={shellHighlight} x1="0" x2="100" y1="0" y2="0">
            <stop offset="0%" stopColor="transparent" />
            <stop offset="42%" stopColor="transparent" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="58%" stopColor="transparent" />
            <stop offset="100%" stopColor="transparent" />
          </linearGradient>

          <filter filterUnits="userSpaceOnUse" height="140%" id={shellGlow} width="140%" x="-20%" y="-20%">
            <feGaussianBlur result="blur" stdDeviation="3.2" />
          </filter>

          <filter filterUnits="userSpaceOnUse" height="200%" id={eyeGlow} width="200%" x="-50%" y="-50%">
            <feGaussianBlur result="blur" stdDeviation="2.4" />
          </filter>
        </defs>

        <g className="oren-logo__float">
          <g className="oren-logo__reaction">
            <g className="oren-logo__gesture">
          <path
            className="oren-logo__bloom"
            d={SHELL_RING}
            fill={`url(#${glowGradient})`}
            fillRule="evenodd"
            filter={`url(#${shellGlow})`}
          />

          <path
            className="oren-logo__shell"
            d={SHELL_RING}
            fill={`url(#${shellGradient})`}
            fillRule="evenodd"
          />

          <path
            className="oren-logo__shell-highlight"
            d={SHELL_RING}
            fill={`url(#${shellHighlight})`}
            fillRule="evenodd"
            opacity="0"
          />

          <path className="oren-logo__face" d={SHELL_INNER} fill="#07070c" />

          <g className="oren-logo__eyes">
            <g className="oren-logo__eye-pills">
              <ellipse
                className="oren-logo__eye-glow oren-logo__eye-glow--left"
                cx={EYE_LEFT.cx}
                cy={EYE_LEFT.cy}
                fill="#dbeafe"
                filter={`url(#${eyeGlow})`}
                rx={EYE_LEFT.rx + 2}
                ry={EYE_LEFT.ry + 1.5}
              />
              <ellipse
                className="oren-logo__eye-glow oren-logo__eye-glow--right"
                cx={EYE_RIGHT.cx}
                cy={EYE_RIGHT.cy}
                fill="#dbeafe"
                filter={`url(#${eyeGlow})`}
                rx={EYE_RIGHT.rx + 2}
                ry={EYE_RIGHT.ry + 1.5}
              />
              <rect
                className="oren-logo__eye oren-logo__eye--left"
                fill="#eef6ff"
                height={EYE_LEFT.ry * 2}
                rx={EYE_LEFT.rx}
                width={EYE_LEFT.rx * 2}
                x={EYE_LEFT.cx - EYE_LEFT.rx}
                y={EYE_LEFT.cy - EYE_LEFT.ry}
              />
              <rect
                className="oren-logo__eye oren-logo__eye--right"
                fill="#eef6ff"
                height={EYE_RIGHT.ry * 2}
                rx={EYE_RIGHT.rx}
                width={EYE_RIGHT.rx * 2}
                x={EYE_RIGHT.cx - EYE_RIGHT.rx}
                y={EYE_RIGHT.cy - EYE_RIGHT.ry}
              />
            </g>

            <g className="oren-logo__eye-happy">
              <path
                d={HAPPY_EYE_LEFT}
                fill="none"
                stroke="#eef6ff"
                strokeLinecap="round"
                strokeWidth="3.2"
              />
              <path
                d={HAPPY_EYE_RIGHT}
                fill="none"
                stroke="#eef6ff"
                strokeLinecap="round"
                strokeWidth="3.2"
              />
            </g>
          </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
