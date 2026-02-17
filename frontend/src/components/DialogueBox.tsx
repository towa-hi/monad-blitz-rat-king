import type { JSX } from "react";

/** Props for the DialogueBox component. */
export interface DialogueBoxProps {
  /** Speaker name displayed above the body text. */
  readonly name: string;
  /** Path to the speaker's portrait image. */
  readonly portrait: string;
  /** Dialogue body text. */
  readonly body: string;
}

/**
 * RPG-style dialogue box with a portrait, speaker name, and body text.
 * Designed to sit at the bottom of a panel.
 * @param props - Speaker name, portrait path, and body text.
 * @returns The dialogue box UI.
 */
export function DialogueBox(props: DialogueBoxProps): JSX.Element {
  return (
    <div className="flex items-stretch gap-4 rounded-xl border-2 border-[#d9ae78] bg-[#fff8ec] p-4 shadow-[0_4px_20px_rgba(72,43,16,0.15)]">
      {/* Portrait */}
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 border-[#d9ae78] bg-[#fff3df]">
        <img
          src={props.portrait}
          alt={`${props.name} portrait`}
          className="h-full w-full object-cover p-2"
        />
      </div>
      {/* Dialogue text */}
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <p className="text-xs font-bold uppercase tracking-widest text-[#9a5d20]">
          {props.name}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-[#3f2a14]">
          {props.body}
        </p>
      </div>
    </div>
  );
}
