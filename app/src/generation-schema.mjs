// Grammar schema for node-llama-cpp's createGrammarForJsonSchema().
//
// This is a deliberately STRICTER subset of the official Ideogram 4 schema
// (see ideogram-schema.mjs): every property here is always generated, in this
// exact key order, because node-llama-cpp grammars emit all listed properties
// in definition order. Always-present optional fields (high_level_description,
// bbox, color_palette) are valid per the official schema, so stricter is safe.
//
// Grammar-level guarantees: structure, key order, types, oneOf branching,
// array lengths, string min lengths. NOT expressible at the grammar level
// (per node-llama-cpp's GbnfJsonSchema subset — verified against the installed
// types): regex patterns (hex colors), integer ranges (bbox 0-1000), and
// "medium must not be 'photograph'" in the art branch. Those are handled
// deterministically by normalize.mjs and re-checked by validate.mjs.

// "#RRGGBB" is exactly 7 chars; the exact charset is enforced post-generation.
const HEX_COLOR = { type: "string", minLength: 7, maxLength: 7 };

// Generated as a LABELED object so the model writes each coordinate next to
// its axis name — small models reliably confuse positional [y,x,y,x] arrays
// with [x,y,x,y]. The normalizer converts this to the official Ideogram array
// form [y_min, x_min, y_max, x_max] and clamps to 0-1000.
const BBOX = {
  type: "object",
  properties: {
    y_min: { type: "integer" },
    x_min: { type: "integer" },
    y_max: { type: "integer" },
    x_max: { type: "integer" }
  }
};

export const GENERATION_SCHEMA = {
  type: "object",
  required: ["high_level_description", "style_description", "compositional_deconstruction"],
  properties: {
    high_level_description: { type: "string", minLength: 1 },
    style_description: {
      oneOf: [
        {
          type: "object",
          required: ["aesthetics", "lighting", "photo", "medium", "color_palette"],
          properties: {
            aesthetics:    { type: "string", minLength: 1 },
            lighting:      { type: "string", minLength: 1 },
            photo:         { type: "string", minLength: 1 },
            medium:        { const: "photograph" },
            color_palette: { type: "array", items: HEX_COLOR, minItems: 1, maxItems: 16 }
          }
        },
        {
          type: "object",
          required: ["aesthetics", "lighting", "medium", "art_style", "color_palette"],
          properties: {
            aesthetics:    { type: "string", minLength: 1 },
            lighting:      { type: "string", minLength: 1 },
            medium:        { type: "string", minLength: 1 },
            art_style:     { type: "string", minLength: 1 },
            color_palette: { type: "array", items: HEX_COLOR, minItems: 1, maxItems: 16 }
          }
        }
      ]
    },
    compositional_deconstruction: {
      type: "object",
      required: ["background", "elements"],
      properties: {
        background: { type: "string", minLength: 1 },
        elements: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: {
            oneOf: [
              {
                type: "object",
                required: ["type", "bbox", "desc", "color_palette"],
                properties: {
                  type:          { const: "obj" },
                  bbox:          BBOX,
                  desc:          { type: "string", minLength: 1 },
                  color_palette: { type: "array", items: HEX_COLOR, minItems: 1, maxItems: 5 }
                }
              },
              {
                type: "object",
                required: ["type", "bbox", "text", "desc", "color_palette"],
                properties: {
                  type:          { const: "text" },
                  bbox:          BBOX,
                  text:          { type: "string", minLength: 1 },
                  desc:          { type: "string", minLength: 1 },
                  color_palette: { type: "array", items: HEX_COLOR, minItems: 1, maxItems: 5 }
                }
              }
            ]
          }
        }
      }
    }
  }
};
};
