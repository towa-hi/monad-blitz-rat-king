import { useState, useEffect, useRef } from "react";
import type { JSX } from "react";

/** Starting countdown time in seconds. */
const COUNTDOWN_START_SECONDS = 60;

/**
 * A countdown timer that counts down from one minute.
 * Displays a label and the remaining time in MM:SS format.
 * @returns The countdown timer UI.
 */
export function CountdownTimer(): JSX.Element {
  const [remaining, setRemaining] = useState<number>(COUNTDOWN_START_SECONDS);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 0) {
          if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return (): void => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const display = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return (
    <div className="flex flex-col">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-white">
        Submit your contribution
      </p>
      <p className="text-2xl font-black tabular-nums text-white">{display}</p>
    </div>
  );
}
