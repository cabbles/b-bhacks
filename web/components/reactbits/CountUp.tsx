// From React Bits (https://reactbits.dev/r/CountUp-TS-TW), copied as source per its install guide.
'use client';

import { useInView, useMotionValue, useSpring } from 'motion/react';
import { useCallback, useEffect, useRef } from 'react';

interface CountUpProps {
  to: number;
  from?: number;
  direction?: 'up' | 'down';
  delay?: number;
  duration?: number;
  className?: string;
  startWhen?: boolean;
  separator?: string;
  onStart?: () => void;
  onEnd?: () => void;
}

export default function CountUp({
  to,
  from = 0,
  direction = 'up',
  delay = 0,
  duration = 2,
  className = '',
  startWhen = true,
  separator = '',
  onStart,
  onEnd
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(direction === 'down' ? to : from);

  const damping = 20 + 40 * (1 / duration);
  const stiffness = 100 * (1 / duration);

  const springValue = useSpring(motionValue, {
    damping,
    stiffness
  });

  const isInView = useInView(ref, { once: true, margin: '0px' });

  const getDecimalPlaces = (num: number): number => {
    const str = num.toString();
    if (str.includes('.')) {
      const decimals = str.split('.')[1];
      if (parseInt(decimals) !== 0) {
        return decimals.length;
      }
    }
    return 0;
  };

  const maxDecimals = Math.max(getDecimalPlaces(from), getDecimalPlaces(to));

  const formatValue = useCallback(
    (latest: number) => {
      const hasDecimals = maxDecimals > 0;

      const options: Intl.NumberFormatOptions = {
        useGrouping: !!separator,
        minimumFractionDigits: hasDecimals ? maxDecimals : 0,
        maximumFractionDigits: hasDecimals ? maxDecimals : 0
      };

      const formattedNumber = Intl.NumberFormat('en-US', options).format(latest);

      return separator ? formattedNumber.replace(/,/g, separator) : formattedNumber;
    },
    [maxDecimals, separator]
  );

  // Local change: snap to the final value after the animation window even if the in-view trigger or
  // animation frames never fire (hidden tab, throttled browser), so a wrong number never stays on screen.
  useEffect(() => {
    const target = direction === 'down' ? from : to;
    const id = setTimeout(() => {
      if (ref.current) ref.current.textContent = formatValue(target);
    }, (delay + duration) * 1000 + 400);
    return () => clearTimeout(id);
  }, [from, to, direction, delay, duration, formatValue]);

  // Local change: only show the start value on first render, so a live update animates from the
  // current number instead of flashing back to `from`.
  const shownRef = useRef(false);
  useEffect(() => {
    if (ref.current && !shownRef.current) {
      ref.current.textContent = formatValue(direction === 'down' ? to : from);
      shownRef.current = true;
    }
  }, [from, to, direction, formatValue]);

  useEffect(() => {
    if (isInView && startWhen) {
      if (typeof onStart === 'function') {
        onStart();
      }

      const target = direction === 'down' ? from : to;
      const settle = () => {
        if (ref.current) ref.current.textContent = formatValue(target);
      };
      // Local change: never leave a wrong number on screen. With no animation frames (hidden tab,
      // reduced motion) jump straight to the value; otherwise snap to it once the spring should be done.
      const still =
        document.visibilityState === 'hidden' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (still) {
        motionValue.jump(target);
        settle();
      }
      const settleId = setTimeout(settle, (delay + duration) * 1000 + 400);

      const timeoutId = setTimeout(() => {
        motionValue.set(target);
      }, delay * 1000);

      const durationTimeoutId = setTimeout(
        () => {
          if (typeof onEnd === 'function') {
            onEnd();
          }
        },
        delay * 1000 + duration * 1000
      );

      return () => {
        clearTimeout(settleId);
        clearTimeout(timeoutId);
        clearTimeout(durationTimeoutId);
      };
    }
  }, [isInView, startWhen, motionValue, direction, from, to, delay, onStart, onEnd, duration, formatValue]);

  useEffect(() => {
    const unsubscribe = springValue.on('change', (latest: number) => {
      if (ref.current) {
        ref.current.textContent = formatValue(latest);
      }
    });

    return () => unsubscribe();
  }, [springValue, formatValue]);

  return <span className={className} ref={ref} />;
}
