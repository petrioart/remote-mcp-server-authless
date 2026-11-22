import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

/**
 * Portrait AI Director MCP v0.2 – stateless project continuity.
 *
 * SECURITY: The endpoint is still public and unauthenticated. Do not send real
 * client data. No session state or project information is stored on the server.
 * The caller must retain the returned state_json and pass it back on each update.
 */

const planningSteps = [
  { key: "genre", label: "Genre", question: "What portrait genre should we pursue?" },
  { key: "visual_style", label: "Visual style", question: "Which artistic direction and substyle best support this concept?" },
  { key: "story_character", label: "Story and character", question: "Who is the character, and what story or feeling should the image convey?" },
  { key: "framing", label: "Framing", question: "Choose orientation, crop, subject scale, and negative space." },
  { key: "wardrobe", label: "Wardrobe", question: "What clothing, fabrics, silhouettes, and accessories support the character?" },
  { key: "hair_makeup", label: "Hair and makeup", question: "How should hair and makeup reinforce the chosen style?" },
  { key: "colors_look", label: "Colors and look", question: "Choose a deliberate palette, tonal range, contrast, and finishing approach." },
  { key: "posing", label: "Posing", question: "What body language, hands, gaze, and expression tell the story?" },
  { key: "camera_lens", label: "Camera and lens", question: "Which camera and lens will be used?" },
  { key: "camera_settings", label: "Camera settings", question: "Confirm aperture, shutter speed, ISO, and white balance together." },
  { key: "studio_lighting", label: "Studio lighting", question: "Plan all sources, powers, modifiers, directions, heights, and distances." },
  { key: "background_set", label: "Background and set", question: "What background and set or compositing approach completes the scene?" },
  { key: "full_scene_preview", label: "Full scene preview", question: "Has the complete scene preview been reviewed and approved?" },
  { key: "props_elements", label: "Props and image elements", question: "Which remaining props or separate composite elements are required?" },
] as const;

type StepKey = (typeof planningSteps)[number]["key"];
const stepKeys = planningSteps.map((step) => step.key) as [StepKey, ...StepKey[]];
const validKeys = new Set<string>(stepKeys);
const titleSchema = z.string().trim().min(1).max(120);
const stateSchema = z.object({
  v: z.literal(2),
  title: titleSchema,
  concept: z.string().max(1200),
  revision: z.number().int().min(0).max(9999),
  decisions: z.record(z.string(), z.string()),
}).strict();

type ProjectState = z.infer<typeof stateSchema>;

const guidance = [
  "Keep previously approved decisions unchanged unless the user explicitly revises them.",
  "Start ideation with 10 varied choices; offer five distinct, justified options at later choice points, plus custom input.",
  "Avoid default palette clichés; explain why each suggested color, contrast, fabric, and style fits this image.",
  "Do not invent approvals, fill skipped stages, or regenerate images without a request.",
  "Collect camera and lens before presenting camera settings together; then plan all studio lights.",
  "A revision to an earlier decision may require reviewing later decisions. Never silently erase them.",
  "Never describe state_json as server-side storage. Carry the latest returned state_json into the next tool call.",
];

function parseState(raw: string): ProjectState {
  if (raw.length > 16000) throw new Error("Project state exceeds the 16,000-character demo limit.");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("state_json must be the exact JSON string returned by a previous PAD tool call.");
  }
  const parsed = stateSchema.safeParse(json);
  if (!parsed.success) throw new Error("Invalid or unsupported project state. Start a new project.");
  for (const [key, value] of Object.entries(parsed.data.decisions)) {
    if (!validKeys.has(key) || !value.trim() || value.length > 1200) {
      throw new Error(`Invalid project decision: ${key}`);
    }
  }
  return parsed.data;
}

function report(state: ProjectState, changedStep?: StepKey, previousDecision?: string) {
  const completed = planningSteps.filter((step) => Boolean(state.decisions[step.key]));
  const missing = planningSteps.filter((step) => !state.decisions[step.key]);
  const next = missing[0] ?? null;
  const changedIndex = changedStep ? planningSteps.findIndex((s) => s.key === changedStep) : -1;
  const reviewRecommended = changedStep && previousDecision !== undefined
    ? planningSteps.slice(changedIndex + 1)
        .filter((step) => Boolean(state.decisions[step.key]))
        .map((step) => step.label)
    : [];

  return {
    title: state.title,
    concept: state.concept,
    revision: state.revision,
    status: next ? "in_progress" : "ready_for_review",
    stored_on_server: false,
    // IMPORTANT: supply this complete value as state_json on the next call.
    state_json: JSON.stringify(state),
    decisions: state.decisions,
    progress: {
      completed: completed.length,
      total: planningSteps.length,
      completed_steps: completed.map((step) => step.label),
      missing_steps: missing.map((step) => step.label),
    },
    next_step: next
      ? { key: next.key, label: next.label, question: next.question }
      : null,
    revised_step: changedStep ?? null,
    later_decisions_to_review: reviewRecommended,
    creative_guidance: guidance,
    warning: "Public, unauthenticated prototype. Do not submit personal client information. State survives only when the caller retains and resubmits state_json.",
  };
}

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `PAD project error: ${message}` }],
  };
}

function createServer() {
  const server = new McpServer({
    name: "Portrait AI Director - MCP Prototype",
    version: "0.2.0",
  });

  // Retain the original tools for a known-good MCP connection test.
  server.registerTool(
    "add",
    { inputSchema: z.object({ a: z.number(), b: z.number() }) },
    async ({ a, b }) => textResult(a + b),
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
      if (operation === "divide" && b === 0) return errorResult("Cannot divide by zero.");
      const result = operation === "add" ? a + b
        : operation === "subtract" ? a - b
        : operation === "multiply" ? a * b
        : a / b;
      return textResult(result);
    },
  );

  // Start: only one required field, to avoid large tool-call parameter payloads.
  server.registerTool(
    "pad_build_shoot_plan",
    {
      description:
        "Start a new PAD shoot plan. Only title is required. Returns state_json, progress, and the next planning question. Do not invent user decisions or send personal client data.",
      inputSchema: z.object({
        title: titleSchema,
        concept: z.string().trim().max(1200).optional(),
      }),
    },
    async ({ title, concept }) => {
      const state: ProjectState = {
        v: 2,
        title,
        concept: concept ?? "",
        revision: 0,
        decisions: {},
      };
      return textResult(report(state));
    },
  );

  // Update: exactly three required scalar fields. No server session or database.
  server.registerTool(
    "pad_update_shoot_plan",
    {
      description:
        "Save or revise ONE user-approved decision in a PAD project. Pass state_json EXACTLY from the previous PAD response. Pass step (enum key) and decision (text). Empty decision clears that stage. Returns NEW state_json; use it for every later call. Never silently alter other decisions.",
      inputSchema: z.object({
        state_json: z.string().min(1).max(16000),
        step: z.enum(stepKeys),
        decision: z.string().trim().max(1200),
      }),
    },
    async ({ state_json, step, decision }) => {
      try {
        const oldState = parseState(state_json);
        if (oldState.revision >= 9999) return errorResult("Revision limit reached.");
        const previous = oldState.decisions[step];
        const decisions = { ...oldState.decisions };
        if (decision) decisions[step] = decision;
        else delete decisions[step];
        const updated: ProjectState = {
          ...oldState,
          revision: oldState.revision + 1,
          decisions,
        };
        return textResult(report(updated, step, previous));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Unknown error.");
      }
    },
  );

  // Review: read an existing state without changing any decision.
  server.registerTool(
    "pad_review_shoot_plan",
    {
      description:
        "Read the current PAD project, show all approved decisions, missing stages, and the next question. Requires state_json from the latest PAD response. Does not store anything.",
      inputSchema: z.object({ state_json: z.string().min(1).max(16000) }),
    },
    async ({ state_json }) => {
      try {
        return textResult(report(parseState(state_json)));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Unknown error.");
      }
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
