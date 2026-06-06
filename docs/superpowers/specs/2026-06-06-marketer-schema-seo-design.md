# Marketer Schemas and SEO/Social Panel Design

Date: 2026-06-06
Status: approved design, pending implementation plan

## Summary

Add two marketer-focused capabilities to TVE:

1. An optional component schema layer that makes developer-built Astro components easier and safer for marketers to edit.
2. A universal SEO/Social panel for Astro pages, backed by adapters for the project's existing SEO pattern.

Both features are fallback-first. Existing Astro projects remain editable without schema. Schemas and SEO config only improve selected workflows where the project author opts in.

## Goals

- Keep TVE universal for normal Astro pages and components.
- Let developers expose friendly, safe component editing controls without changing the component render model.
- Give marketers one consistent SEO/Social UI for Astro pages.
- Support existing project patterns such as `<SEO />`, layout props, and direct head tags.
- Allow SEO component insertion only when the project config defines the correct insertion point.
- Reuse existing mutation, image picker, page picker, and component prop infrastructure where possible.

## Non-goals

- No Markdown/MDX SEO editing in v1.
- No arbitrary data-source editing, such as values returned by `await getCampaignHero()`.
- No execution of project schema code.
- No universal SEO runtime or TVE-owned routing layer.
- No automatic guessing for missing SEO insertion points.
- No full block/page-template builder in this design, although the schema model should enable it later.

## Existing Context

TVE already has:

- AST-backed `.astro` parsing and surgical file mutations.
- Component prop extraction from Astro frontmatter `interface Props` and `type Props`.
- Marketer mode with content, link, image, and component prop editing.
- Image library and upload support for public assets.
- Static Astro page creation.
- Git/publish workflow surfaces.

The design builds on those systems rather than replacing them.

## Feature 1: Marketer Component Schema Layer

### Concept

Developers can add an optional schema file beside a component:

```txt
src/components/Hero.astro
src/components/Hero.tve.ts
```

The schema describes marketer-facing labels, field types, groups, validation, and visibility. If the schema is absent or partially unsupported, TVE falls back to the current prop inference behavior.

### Fallback Order

For a selected component instance, TVE resolves editable fields in this order:

1. Static `.tve.ts` schema next to the component, merged with the introspected Astro `Props` schema.
2. Astro `Props` interface or type alias, as today.
3. Attribute keys observed on other instances of the same tag in the current AST.
4. The selected element's current attributes.

This keeps unschematized sites usable and lets schemas improve important marketing blocks incrementally.

### Schema File Shape

Schema files use a TypeScript-looking format for authoring comfort, but v1 reads them statically through the TypeScript compiler API. TVE does not execute the file.

```ts
export default defineTveComponent({
  label: "Hero",
  category: "Hero",
  description: "Primary landing page hero with CTA and image",
  fields: {
    title: {
      type: "text",
      label: "Headline",
      required: true,
      maxLength: 90,
      group: "Content",
    },
    description: {
      type: "textarea",
      label: "Intro copy",
      maxLength: 180,
      group: "Content",
    },
    image: {
      type: "image",
      label: "Hero image",
      required: true,
      group: "Media",
    },
    ctaHref: {
      type: "link",
      label: "Button link",
      allowPages: true,
      allowExternal: true,
      group: "CTA",
    },
    variant: {
      type: "choice",
      label: "Layout",
      options: [
        { value: "image-right", label: "Image right" },
        { value: "image-left", label: "Image left" },
      ],
      group: "Design",
    },
  },
});
```

Supported static values:

- strings
- numbers
- booleans
- null
- arrays of supported values
- object literals

Unsupported expressions are ignored with a warning in the API response. This avoids running arbitrary project code.

### Field Types

V1 field types:

- `text`: single-line string input
- `textarea`: multi-line string input
- `richText`: rich text where the target prop can safely hold text or markdown-like content
- `image`: asset picker backed by the existing image library
- `link`: URL/page picker backed by the existing `LinkSection`
- `choice`: select control with friendly labels
- `boolean`: checkbox
- `number`: numeric input

Future field types:

- `icon`
- `colorToken`
- `collectionEntry`
- `date`
- `tags`
- `repeater`

### Merge With Props

The schema augments `ComponentPropField` rather than replacing it. The server returns a richer component editor schema:

```ts
interface TveComponentSchema {
  componentPath: string;
  source: "tve-schema" | "props" | "usage" | "attributes";
  label?: string;
  category?: string;
  description?: string;
  fields: TveComponentField[];
  warnings: string[];
}
```

Each `TveComponentField` includes the existing prop shape plus optional marketer metadata:

```ts
interface TveComponentField {
  name: string;
  kind: "text" | "textarea" | "richText" | "image" | "link" | "choice" | "boolean" | "number" | "unknown";
  label: string;
  group: string;
  required: boolean;
  hidden?: boolean;
  advanced?: boolean;
  description?: string;
  placeholder?: string;
  maxLength?: number;
  options?: Array<{ value: string; label: string }>;
  propKind?: ComponentPropField["kind"];
}
```

If both the Astro `Props` interface and `.tve.ts` define the same field, the prop type controls the safe write format and the `.tve.ts` metadata controls the marketer UI.

### UI Behavior

In Marketer mode:

- Show schema groups such as Content, Media, CTA, Design, and Advanced.
- Use schema labels instead of raw prop names.
- Show required indicators and validation warnings.
- Hide fields marked `hidden`.
- Collapse fields marked `advanced`.
- Use image and link controls for schema-typed fields even when prop names are not heuristic matches.

In Dev mode:

- Keep existing raw class and attribute power tools.
- Use schema labels where helpful, but do not hide the lower-level controls.

### API

Add:

```txt
GET /api/schema/component?path=src/components/Hero.astro
```

Returns the resolved `TveComponentSchema`.

Keep `GET /api/components/props` for backwards compatibility, but the editor should move toward the schema endpoint for component editing.

### Validation

V1 validation is UI-level and publish-panel-level, not mutation-blocking:

- Missing required fields
- Text over `maxLength`
- Invalid option value for `choice`
- Empty link when required
- Empty image when required

Server-side hard rejection can be added later once every write path has capability metadata.

## Feature 2: SEO/Social Panel For Astro Pages

### Concept

Marketers get a single SEO/Social panel for Astro pages. The panel edits a universal SEO model, while adapters read and write to the project's existing pattern.

Universal model:

```ts
interface SeoPageData {
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  twitterImage: string;
  noindex: boolean;
}
```

### V1 Scope

V1 supports Astro pages only:

- files under `src/pages/**/*.astro`
- not `src/content/**/*.md`
- not MDX
- not dynamic data returned by arbitrary JavaScript

### Adapters

V1 adapters:

1. SEO component adapter

```astro
<SEO title="Pricing" description="Simple pricing" image="/images/og/pricing.webp" />
```

2. Layout props adapter

```astro
<Layout title="Pricing" description="Simple pricing" ogImage="/images/og/pricing.webp">
```

3. Direct head tags adapter, only when tags are obvious and static

```astro
<title>Pricing</title>
<meta name="description" content="Simple pricing" />
```

Adapter priority:

1. Project config preferred adapter.
2. Existing `<SEO />` component if configured or obvious by tag name.
3. Existing layout props when configured.
4. Direct head tags when present and static.
5. Read-only setup state when no safe pattern is found.

### Project Config

Use the existing project-level `tve.config.json` in v1. Statically parsed `tve.config.ts` is deferred so the first implementation has one config source and does not need to reconcile JSON and TypeScript config precedence.

Example JSON shape:

```json
{
  "seo": {
    "preferredAdapter": "component",
    "component": {
      "tagName": "SEO",
      "path": "src/components/SEO.astro",
      "insertion": {
        "mode": "layout-slot",
        "layout": "Layout",
        "slot": "head"
      },
      "fields": {
        "title": "title",
        "description": "description",
        "ogImage": "image",
        "canonical": "canonical",
        "noindex": "noindex"
      }
    }
  }
}
```

### Safe Insertion

The SEO panel can insert an SEO component only when all of these are true:

- The page is an Astro page.
- No existing SEO target is found.
- Project config defines the SEO component path.
- Project config defines the insertion mode.
- The insertion target exists in the current page source.

Supported v1 insertion modes:

1. `layout-slot`

```astro
<Layout>
  <Fragment slot="head">
    <SEO title="..." description="..." />
  </Fragment>
  ...
</Layout>
```

2. `before-layout`

```astro
<SEO title="..." description="..." />
<Layout>
  ...
</Layout>
```

3. `inside-layout-first-child`

```astro
<Layout>
  <SEO title="..." description="..." />
  ...
</Layout>
```

No insertion should happen when the configured target is missing. The panel shows setup guidance instead.

### SEO Panel UI

Add a `Properties | SEO` segmented switch in the right sidebar header. `Properties` remains the default. `SEO` is available for Astro pages even when no element is selected, and is hidden or disabled for non-page files.

Fields:

- Page title
- Meta description
- Canonical URL
- OG title
- OG description
- OG image
- Twitter image
- Noindex

Preview cards:

- Search result preview
- Social card preview

Warnings:

- Missing title
- Missing description
- Title too long
- Description too long
- Missing OG image
- Missing canonical
- Noindex enabled
- SEO component missing
- Configured insertion target missing
- Dynamic expression values are read-only

Controls:

- Save SEO
- Add SEO to page, shown only for safe configured insertion
- Open image picker for social images

### API

Add:

```txt
GET /api/seo/page?path=src/pages/pricing.astro
POST /api/seo/page?path=src/pages/pricing.astro
POST /api/seo/page/add?path=src/pages/pricing.astro
```

`GET` returns:

```ts
interface SeoPageResponse {
  path: string;
  editable: boolean;
  adapter: "component" | "layout-props" | "head-tags" | "none";
  found: boolean;
  canInsert: boolean;
  data: Partial<SeoPageData>;
  fields: Record<keyof SeoPageData, SeoFieldState>;
  warnings: SeoWarning[];
}
```

Each field state records whether it is static and writable:

```ts
interface SeoFieldState {
  value: string | boolean | null;
  writable: boolean;
  reason?: string;
  source?: {
    kind: "component-prop" | "layout-prop" | "head-tag";
    nodeId?: string;
    prop?: string;
  };
}
```

`POST /api/seo/page` updates writable fields through adapter-specific source edits.

`POST /api/seo/page/add` inserts the configured SEO component with the submitted initial data, adds the import if needed, re-parses the page, and returns the new SEO response.

### Source Editing

SEO writes should reuse the existing conservative mutation style:

- Use Astro parser node positions where possible.
- Validate source ranges before writing.
- Only edit static quoted attributes or text nodes.
- Refuse to overwrite JSX expression values like `title={pageTitle}`.
- Use `magic-string`.
- Re-parse after writes and return updated state.

For import insertion, reuse or extract the existing component-import logic from `file-writer.ts` so SEO insertion can add:

```astro
import SEO from "../components/SEO.astro";
```

without duplicating imports.

## Data Flow

### Component Schema

1. User selects a component.
2. Editor requests `GET /api/schema/component`.
3. Server loads Astro `Props` plus optional `.tve.ts` schema.
4. Server returns merged schema with warnings.
5. Editor renders grouped marketer controls.
6. Field changes call existing `update-attribute` mutations.

### SEO Panel

1. User opens an Astro page.
2. Editor requests `GET /api/seo/page`.
3. Server analyzes the page and resolves an adapter.
4. Editor renders fields, previews, and warnings.
5. User edits SEO fields.
6. Editor posts changed values.
7. Server applies adapter-specific source edits.
8. Server re-parses and returns fresh SEO state.

## Error Handling

- Invalid schema file: return fallback schema plus warnings.
- Unsupported schema expression: ignore that value and report a warning.
- Missing SEO config: show setup/read-only SEO panel.
- Missing configured insertion target: disable Add SEO and show reason.
- Dynamic SEO values: field is read-only with explanation.
- Mutation range validation failure: reject write and keep previous UI state.

## Testing Plan

Server tests:

- Parse `.tve.ts` component schema object literals.
- Merge `.tve.ts` metadata with Astro `Props`.
- Fallback when schema is missing.
- Ignore unsupported schema expressions.
- Detect existing SEO component and read static props.
- Update SEO component static props.
- Refuse to overwrite expression props.
- Insert SEO component in each supported insertion mode.
- Add missing SEO import without duplicating imports.
- Read and update layout-prop SEO fields.
- Read and update direct head tags when static.
- Reject non-page paths and traversal attempts.

Editor tests:

- Component props panel uses schema labels, groups, and field controls.
- Link/image schema fields use existing picker controls.
- SEO panel shows data from API response.
- SEO warnings render.
- Add SEO button appears only when `canInsert` is true.
- Dynamic read-only fields are disabled with reasons.

Manual checks:

- Existing unschematized project behaves as before.
- Schematized Hero component shows marketer-friendly fields.
- Astro page with existing `<SEO />` can edit title, description, image, canonical.
- Astro page without `<SEO />` can add it when config defines insertion.
- Astro page without config does not guess insertion.

## Implementation Sequence

1. Add shared schema and SEO types.
2. Add static schema reader for component `.tve.ts` files.
3. Add `GET /api/schema/component`.
4. Update `ComponentPropsPanel` to consume resolved schema.
5. Add project SEO config reader.
6. Add SEO analyzer for Astro pages.
7. Add SEO writer for existing component/layout/head adapters.
8. Add safe SEO component insertion.
9. Add editor SEO store and panel.
10. Add preview cards and warnings.
11. Add tests and update docs.

## Risks

- Astro projects vary widely, so v1 must stay conservative.
- Static parsing of `.tve.ts` is less flexible than executing config, but much safer.
- Direct head tag editing can become fragile if tags are generated indirectly.
- SEO insertion can break pages if placement is guessed, so v1 requires explicit config.
- Component schemas can drift from actual props; merging with the parsed `Props` schema reduces that risk.

## V1 Decisions

- Project SEO config is read from `tve.config.json` only.
- Component schemas use statically parsed `.tve.ts` files next to components.
- The SEO panel lives in the right sidebar behind a `Properties | SEO` switch.
- Required-field validation warns in v1 and returns machine-readable warnings; it does not block publish until the publish flow consumes those warnings.
- `richText` renders as a larger text editor and writes a plain string in v1. Reusing the Markdown editor is deferred.

## Acceptance Criteria

- Unschemaed Astro components remain editable through current fallback behavior.
- A component with `Component.tve.ts` renders marketer-friendly labels, groups, and controls.
- Astro pages expose a SEO/Social panel independent of selected element.
- Existing configured `<SEO />` components can be read and edited.
- Missing `<SEO />` can be inserted only with explicit config.
- No dynamic expression SEO prop is overwritten by a string.
- Server and editor tests cover the schema reader and SEO adapters.
