// Final validation gate. A caption is only reported "valid" if it passes:
//   1. AJV validation against the full official Ideogram 4 JSON Schema
//      (ideogram-schema.mjs), including hex patterns and bbox ranges.
//   2. Strict key-order checks (the docs require consistent key ordering,
//      which JSON Schema cannot express).
//   3. bbox semantic check: y_min <= y_max and x_min <= x_max.
// Nothing is served to the user unless this returns valid: true.

import { Ajv } from "ajv";
import { IDEOGRAM_SCHEMA, KEY_ORDER } from "./ideogram-schema.mjs";

const ajv = new Ajv({ allErrors: true });
const ajvValidate = ajv.compile(IDEOGRAM_SCHEMA);

// Object keys must appear in canonical order (missing optional keys allowed).
function checkKeyOrder(obj, canonicalOrder, label, errors) {
  const actual = Object.keys(obj);
  const expected = canonicalOrder.filter((key) => key in obj);
  if (actual.join(",") !== expected.join(",")) {
    errors.push(
      `${label}: keys are [${actual.join(", ")}], expected order [${expected.join(", ")}]`
    );
  }
}

export function validateCaption(caption) {
  const errors = [];

  if (!ajvValidate(caption)) {
    for (const err of ajvValidate.errors ?? []) {
      errors.push(`schema${err.instancePath || "/"}: ${err.message}`);
    }
  }

  if (typeof caption === "object" && caption !== null && !Array.isArray(caption)) {
    checkKeyOrder(caption, KEY_ORDER.top, "top level", errors);

    const style = caption.style_description;
    if (typeof style === "object" && style !== null && !Array.isArray(style)) {
      const order = "photo" in style ? KEY_ORDER.stylePhoto : KEY_ORDER.styleArt;
      checkKeyOrder(style, order, "style_description", errors);
    }

    const comp = caption.compositional_deconstruction;
    if (typeof comp === "object" && comp !== null && !Array.isArray(comp)) {
      checkKeyOrder(comp, KEY_ORDER.composition, "compositional_deconstruction", errors);
      if (Array.isArray(comp.elements)) {
        comp.elements.forEach((element, i) => {
          if (typeof element !== "object" || element === null) return;
          const order =
            element.type === "text" ? KEY_ORDER.elementText : KEY_ORDER.elementObj;
          checkKeyOrder(element, order, `elements[${i}]`, errors);
          if (Array.isArray(element.bbox) && element.bbox.length === 4) {
            const [yMin, xMin, yMax, xMax] = element.bbox;
            if (yMin > yMax || xMin > xMax) {
              errors.push(
                `elements[${i}].bbox: expected y_min <= y_max and x_min <= x_max`
              );
            }
          }
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
