import type { JSX } from "react";

/** Describes a single sprite to render in the viewport. */
export interface SpriteData {
  /** Unique identifier for this sprite. */
  readonly id: string;
  /** Image source path. */
  readonly src: string;
  /** Alt text for accessibility. */
  readonly alt: string;
  /** Horizontal position as a percentage (0-100) from the left. */
  readonly x: number;
  /** Vertical position as a percentage (0-100) from the top. */
  readonly y: number;
  /** Width in pixels. */
  readonly width: number;
  /** Height in pixels. */
  readonly height: number;
}

/** Props for the SpriteLayer component. */
interface SpriteLayerProps {
  /** Array of sprites to render. */
  readonly sprites: SpriteData[];
}

/**
 * Renders positioned sprites as an overlay layer.
 * Should be placed inside a relative-positioned container.
 * @param props - Array of sprite data to render.
 * @returns An absolutely positioned layer of sprite images.
 */
export function SpriteLayer(props: SpriteLayerProps): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0">
      {props.sprites.map((sprite) => (
        <img
          key={sprite.id}
          src={sprite.src}
          alt={sprite.alt}
          className="absolute object-contain"
          style={{
            left: `${sprite.x}%`,
            top: `${sprite.y}%`,
            width: `${sprite.width}px`,
            height: `${sprite.height}px`,
            transform: "translate(-50%, -100%)",
          }}
        />
      ))}
    </div>
  );
}
