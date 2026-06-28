// Grammar schema for llama-server's response_format json_schema.
//
// This is a deliberately STRICTER subset of the official Ideogram 4 schema
// (see ideogram-schema.mjs): every property here is always generated, in this
// exact key order, because the grammar emits all listed properties in
// definition order.
//
// Key change vs original: "required" arrays are added at every level so the
// grammar enforcer treats all fields as mandatory — the model can no longer
// silently skip style_description or any other top-level field.
//
// Grammar-level guarantees: structure, key order, types, oneOf branching,
// array lengths, string min lengths, required fields.
// NOT expressible at grammar level: regex patterns (hex colors), integer
// ranges (bbox 0-1000). Those are handled by normalize.mjs / validate.mjs.

// "#RRGGBB" is exactly 7 chars; exact charset enforced post-generation.
const HEX_COLOR = { type: "string", minLength: 7, maxLength: 7 };

// Generated as a LABELED object so the model writes each coordinate next to
// its axis name — small models reliably confuse positional [y,x,y,x] arrays
// with [x,y,x,y]. The normalizer converts this to the official Ideogram array
// form [y_min, x_min, y_max, x_max] and clamps to 0-1000.
const BBOX = {
  type: "object",
  required: ["y_min", "x_min", "y_max", "x_max"],
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
          // Photograph variant
          type: "object",
          required: ["aesthetics", "lighting", "photo", "medium", "color_palette"],
          properties: {
            aesthetics: { type: "string", minLength: 1 },
            lighting:   { type: "string", minLength: 1 },
            photo:      { type: "string", minLength: 1 },
            medium:     { const: "photograph" },
            color_palette: {
              type: "array",
              items: HEX_COLOR,
              minItems: 1,
              maxItems: 16
            }
          }
        },
        {
          // Art variant (illustration, 3d_render, painting, graphic_design, …)
          type: "object",
          required: ["aesthetics", "lighting", "medium", "art_style", "color_palette"],
          properties: {
            aesthetics: { type: "string", minLength: 1 },
            lighting:   { type: "string", minLength: 1 },
            medium:     { type: "string", minLength: 1 },
            art_style:  { type: "string", minLength: 1 },
            color_palette: {
              type: "array",
              items: HEX_COLOR,
              minItems: 1,
              maxItems: 16
            }
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
                // Object element
                type: "object",
                required: ["type", "bbox", "desc", "color_palette"],
                properties: {
                  type: { const: "obj" },
                  bbox: BBOX,
                  desc: { type: "string", minLength: 1 },
                  color_palette: {
                    type: "array",
                    items: HEX_COLOR,
                    minItems: 1,
                    maxItems: 5
                  }
                }
              },
              {
                // Text element (text = literal string to render in the image)
                type: "object",
                required: ["type", "bbox", "text", "desc", "color_palette"],
                properties: {
                  type: { const: "text" },
                  bbox: BBOX,
                  text: { type: "string", minLength: 1 },
                  desc: { type: "string", minLength: 1 },
                  color_palette: {
                    type: "array",
                    items: HEX_COLOR,
                    minItems: 1,
                    maxItems: 5
                  }
                }
              }
            ]
          }
        }
      }
    }

  }
};
