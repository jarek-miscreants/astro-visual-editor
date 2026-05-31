import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Astro 6 content layer: collections are defined with a loader + schema.
// The blog fixture uses the Markdown files under src/content/blog.
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    draft: z.boolean().default(false),
    author: z.string().optional(),
    featured: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { blog };
