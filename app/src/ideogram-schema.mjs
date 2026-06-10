// Ideogram 4 JSON caption schema, transcribed from the official documentation:
// https://github.com/ideogram-oss/ideogram4/blob/main/docs/prompting.md
//
// Constraints encoded here:
// - `compositional_deconstruction` is the only required top-level field.
// - `style_description` must contain exactly one of `photo` (medium must be
//   "photograph") or `art_style` (medium must NOT be "photograph").
// - Hex colors are uppercase #RRGGBB. Up to 16 in style_description,
//   up to 5 per element.
// - bbox is [y_min, x_min, y_max, x_max], integers in 0-1000 normalized
//   coordinates, origin top-left.
//
// Key ORDER is also strict per the docs, but JSON Schema cannot express key
// order — that is enforced by normalize.mjs and checked in validate.mjs.

const HEX_COLOR = { type: "string", pattern: "^#[0-9A-F]{6}$" };

const STYLE_PALETTE = {
  type: "array",
  items: HEX_COLOR,
  minItems: 1,
  maxItems: 16
};

const ELEMENT_PALETTE = {
  type: "array",
  items: HEX_COLOR,
  minItems: 1,
  maxItems: 5
};

const BBOX = {
  type: "array",
  items: { type: "integer", minimum: 0, maximum: 1000 },
  minItems: 4,
  maxItems: 4
};

export const IDEOGRAM_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Ideogram 4 JSON caption",
  type: "object",
  additionalProperties: false,
  required: ["compositional_deconstruction"],
  properties: {
    high_level_description: { type: "string", minLength: 1 },
    style_description: {
      type: "object",
      oneOf: [
        {
          // Photograph variant: key order aesthetics, lighting, photo, medium, color_palette
          additionalProperties: false,
          required: ["aesthetics", "lighting", "photo", "medium"],
          properties: {
            aesthetics: { type: "string", minLength: 1 },
            lighting: { type: "string", minLength: 1 },
            photo: { type: "string", minLength: 1 },
            medium: { const: "photograph" },
            color_palette: STYLE_PALETTE
          }
        },
        {
          // Art variant: key order aesthetics, lighting, medium, art_style, color_palette
          additionalProperties: false,
          required: ["aesthetics", "lighting", "medium", "art_style"],
          properties: {
            aesthetics: { type: "string", minLength: 1 },
            lighting: { type: "string", minLength: 1 },
            medium: {
              type: "string",
              minLength: 1,
              not: { const: "photograph" }
            },
            art_style: { type: "string", minLength: 1 },
            color_palette: STYLE_PALETTE
          }
        }
      ]
    },
    compositional_deconstruction: {
      type: "object",
      additionalProperties: false,
      required: ["background", "elements"],
      properties: {
        background: { type: "string", minLength: 1 },
        elements: {
          type: "array",
          minItems: 1,
          items: {
            oneOf: [
              {
                // Object element: key order type, bbox, desc, color_palette
                type: "object",
                additionalProperties: false,
                required: ["type", "desc"],
                properties: {
                  type: { const: "obj" },
                  bbox: BBOX,
                  desc: { type: "string", minLength: 1 },
                  color_palette: ELEMENT_PALETTE
                }
              },
              {
                // Text element: key order type, bbox, text, desc, color_palette
                type: "object",
                additionalProperties: false,
                required: ["type", "text", "desc"],
                properties: {
                  type: { const: "text" },
                  bbox: BBOX,
                  text: { type: "string", minLength: 1 },
                  desc: { type: "string", minLength: 1 },
                  color_palette: ELEMENT_PALETTE
                }
              }
            ]
          }
        }
      }
    }
  }
};

// Canonical key orders from the official docs ("key order is strict").
export const KEY_ORDER = {
  top: ["high_level_description", "style_description", "compositional_deconstruction"],
  stylePhoto: ["aesthetics", "lighting", "photo", "medium", "color_palette"],
  styleArt: ["aesthetics", "lighting", "medium", "art_style", "color_palette"],
  composition: ["background", "elements"],
  elementObj: ["type", "bbox", "desc", "color_palette"],
  elementText: ["type", "bbox", "text", "desc", "color_palette"]
};

export const LIMITS = {
  stylePaletteMax: 16,
  elementPaletteMax: 5,
  bboxMin: 0,
  bboxMax: 1000
};
