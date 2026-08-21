import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    // `date` is what makes a page under `blog/` a post: the index at /blog/
    // orders on it, and a page without one stays out of the listing.
    schema: docsSchema({ extend: z.object({ date: z.coerce.date().optional() }) }),
  }),
};
