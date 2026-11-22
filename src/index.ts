import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

// PAD MVP: stateless shoot planning. No client data is stored on the server.
const shootPlanSchema = z.object({
  title: z.string().trim().min(1).max(120),
  genre: z.string().trim().max(240).optional(),
  visual_style: z.string().trim().max(400).optional(),
  story_character: z.string().trim().max(500).optional(),
  framing: z.string().trim().max(250).optional(),
  wardrobe: z.string().trim().max(400).optional(),
  hair_makeup: z.string().trim().max(400).optional(),
  colors_look: z.string().trim().max(500).optional(),
  posing: z.string().trim().max(400).optional(),
  camera_lens: z.string().trim().max(250).optional(),
  camera_settings: z.string().trim().max(250).optional(),
  studio_lighting: z.string().trim().max(600).optional(),
  background_set: z.string().trim().max(500).optional(),
  full_scene_preview: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(1000).optional(),
});

const planningSteps = [
  { key: "genre", label: "Genre", question: "What portrait genre should we pursue?" },
  { key: "visual_style", label: "Visual style", question: "Which artistic or historical visual direction best fits the concept?" },
  { key: "story_character", label: "Story and character", question: "Who is the subject, and what emotion or story should the portrait convey?" },
  { key: "framing", label: "Framing", question: "What framing, orientation, and negative space should we use?" },
  { key: "wardrobe", label: "Wardrobe", question: "What clothing, silhouette, fabrics, and accessories support the story?" },
  { key: "hair_makeup", label: "Hair and makeup", question: "How should hair and makeup reinforce the portrait's visual style?" },
  { key: "colors_look", label: "Colors and look", question: "Which palette, contrast, tonal range, and color treatment work for this image?" },
  { key: "posing", label: "Posing", question: "What pose, hand placement, body language, and facial expression fit the story?" },
  { key: "camera_lens", label: "Camera and lens", question: "Which camera and lens will be used?" },
  { key: "camera_settings", label: "Camera settings", question: "Which aperture, shutter speed, ISO, and white balance are appropriate?" },
  { key: "studio_lighting", label: "Studio lighting", question: "What light positions, modifiers, ratios, and flags are needed?" },
  { key: "background_set", label: "Background and set", question: "What background, set, or compositing elements complete the scene?" },
  { key: "full_scene_preview", label: "Full scene preview", question: "Has the intended full-scene preview been reviewed and approved?" },
] as const;
function createServer() {
  const server = new McpServer({
    name: "Portrait AI Director - MCP Prototype",
    version: "0.1.0",
  });

  // Keep the original calculator tools so the known-good connection can be retested.
  server.registerTool(
    "add",
    { inputSchema: z.object({ a: z.number(), b: z.number() }) },
    async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    }),
  );
  server.registerTool(
    "calculate",
    {
      inputSchema: z.object({
        operation: z.enum(["add", "subtract", "multiply", "divide"]),
        a: z.number(),
        b: z.number(),
      }),
    },
    async ({ operation, a, b }) => {
      let result: number;
      switch (operation) {
        case "add":
          result = a + b;
          break;
        case "subtract":
          result = a - b;
          break;
        case "multiply":
          result = a * b;
          break;
        case "divide":
          if (b === 0)
            return {
              content: [
                { type: "text", text: "Error: Cannot divide by zero" },
              ],
            };
          result = a / b;
          break;
      }
      return { content: [{ type: "text", text: String(result) }] };
    },
  );

  // First PAD tool: builds a structured, progress-aware shoot brief from supplied decisions.
  // Re-submit earlier decisions on subsequent calls: this prototype is intentionally stateless.
  server.registerTool(
    "pad_build_shoot_plan",
    {
      description:
        "Build a structured Portrait AI Director shoot plan from decisions explicitly supplied by the user. Return completed stages, missing stages, and the next question. Stateless demonstration only: do not provide personal client data.",
      inputSchema: shootPlanSchema,
    },
    async (input) => {
      const completed = planningSteps.filter((step) => Boolean(input[step.key]?.trim()));
      const missing = planningSteps.filter((step) => !input[step.key]?.trim());
      const next = missing[0] ?? null;

      const decisions = Object.fromEntries(
        completed.map((step) => [step.key, input[step.key]]),
      );

      const plan = {
        title: input.title,
        status: missing.length ? "in_progress" : "ready_for_review",
        stored_on_server: false,
        decisions,
        notes: input.notes ?? "",
        progress: {
          completed: completed.length,
          total: planningSteps.length,
          completed_steps: completed.map((step) => step.label),
          missing_steps: missing.map((step) => step.label),
        },
        next_step: next
          ? { key: next.key, label: next.label, question: next.question }
          : null,
        creative_guidance: [
          "Preserve all user-approved choices; never silently replace them.",
          "Offer 10 creative genre choices at the start and 5 distinct, justified choices at later decision points; always allow a custom answer.",
          "Do not default to recurring palettes or styles without a reason grounded in this particular image.",
          "Do not generate moodboards or previews unless the user requests one.",
          "Ask about unresolved steps rather than inventing decisions.",
        ],
        limitation:
          "This public demo does not authenticate users or persist projects. Do not send private client details. Pass the full set of current decisions again to update the plan.",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(plan, null, 2) }],
      };
    },
  );

  return server;
}

const handler = createMcpHandler(createServer);

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
