export interface ObjectRecord {
  id: string;
  type: string;
  name: string;
  description: string;
  properties: Record<string, unknown>;
  tags: string[];
  path: string | null;
  createdAt: string;
  modifiedAt: string;
}
export interface Relationship {
  id: string;
  from: string;
  to: string;
  kind: string;
  properties?: Record<string, unknown>;
}
export interface PropertyDefinition {
  key: string;
  type:
    | "text"
    | "number"
    | "boolean"
    | "date"
    | "datetime"
    | "select"
    | "relation"
    | "json";
  required?: boolean;
  options?: string[];
  targetType?: string;
}
export interface TypeDefinition {
  id: string;
  name: string;
  description: string;
  properties: PropertyDefinition[];
}
const state = (key: string, options: string[]): PropertyDefinition => ({
  key,
  type: "select",
  options,
});
const text = (key: string): PropertyDefinition => ({ key, type: "text" });
const boolean = (key: string): PropertyDefinition => ({ key, type: "boolean" });
const processing = () =>
  state("processingState", [
    "inbox",
    "unprocessed",
    "processed",
    "imported",
    "review",
    "archived",
  ]);
const scheduling = (): PropertyDefinition[] => [
  boolean("enabled"),
  text("every"),
  text("timezone"),
];
const builtinProperties: Record<string, PropertyDefinition[]> = {
  project: [
    state("kind", ["ongoing", "finite"]),
    state("status", ["active", "paused", "on-hold", "done", "archived"]),
    text("priority"),
  ],
  task: [
    state("status", [
      "todo",
      "doing",
      "blocked",
      "done",
      "dropped",
      "paused",
      "archived",
    ]),
    { key: "due", type: "date" },
    state("priority", ["high", "med", "low"]),
    processing(),
  ],
  note: [
    processing(),
    { key: "contentDate", type: "date" },
    state("noteType", [
      "general",
      "journal",
      "reflection",
      "learning",
      "research",
      "decision",
      "meeting",
    ]),
  ],
  collection: [
    processing(),
    text("place"),
    { key: "startDate", type: "date" },
    { key: "endDate", type: "date" },
    state("tripStatus", ["idea", "planned", "booked", "done", "dropped"]),
  ],
  area: [],
  person: [
    text("email"),
    { key: "organization", type: "relation", targetType: "organization" },
    text("role"),
    { key: "aliases", type: "json" },
  ],
  book: [
    text("author"),
    state("readingState", [
      "to-read",
      "reading",
      "finished",
      "paused",
      "dropped",
    ]),
    text("url"),
  ],
  organization: [text("website"), { key: "aliases", type: "json" }],
  repository: [
    state("status", ["active", "paused", "archived"]),
    text("url"),
    text("localPath"),
    text("defaultBranch"),
  ],
  meeting: [
    { key: "startsAt", type: "datetime" },
    { key: "endsAt", type: "datetime" },
    text("location"),
  ],
  artifact: [text("about"), text("why"), text("url")],
  tag: [text("description"), text("color")],
  reminder: [
    text("message"),
    ...scheduling(),
    { key: "at", type: "datetime" },
    state("status", [
      "pending",
      "scheduled",
      "sent",
      "cancelled",
      "paused",
      "failed",
    ]),
  ],
  "agent-job": [
    text("instructions"),
    text("agent"),
    ...scheduling(),
    state("provider", ["codex", "claude"]),
    text("model"),
  ],
  "agent-run": [
    state("status", [
      "pending",
      "queued",
      "running",
      "succeeded",
      "success",
      "completed",
      "failed",
      "cancelled",
      "skipped",
    ]),
    { key: "startedAt", type: "datetime" },
    { key: "finishedAt", type: "datetime" },
    text("provider"),
    text("model"),
  ],
};
export const BUILTIN_TYPES: TypeDefinition[] = Object.entries(
  builtinProperties,
).map(([id, properties]) => ({
  id,
  name: id,
  description: `Built-in ${id}`,
  properties,
}));
