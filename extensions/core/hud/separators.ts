import type { SeparatorDef, StatusLineSeparatorStyle } from "./types.js";
import { getSeparatorChars } from "./icons.js";

export function getSeparator(style: StatusLineSeparatorStyle): SeparatorDef {
  const chars = getSeparatorChars();

  switch (style) {
    case "arrow":
      return {
        left: chars.arrowLeft,
        right: chars.arrowRight,
        endCaps: {
          left: chars.arrowRight,
          right: chars.arrowLeft,
          useBgAsFg: true,
        },
      };

    case "arrow-thin":
      return {
        left: chars.arrowThinLeft,
        right: chars.arrowThinRight,
        endCaps: {
          left: chars.arrowRight,
          right: chars.arrowLeft,
          useBgAsFg: true,
        },
      };

    case "slash":
      return { left: ` ${chars.slash} `, right: ` ${chars.slash} ` };

    case "pipe":
      return { left: ` ${chars.pipe} `, right: ` ${chars.pipe} ` };

    case "block":
      return { left: chars.block, right: chars.block };

    case "none":
      return { left: chars.space, right: chars.space };

    case "ascii":
      return { left: chars.asciiLeft, right: chars.asciiRight };

    case "dot":
      return { left: chars.dot, right: chars.dot };

    case "chevron":
      return { left: "›", right: "‹" };

    case "star":
      return { left: "✦", right: "✦" };

    default:
      return getSeparator("arrow-thin");
  }
}
