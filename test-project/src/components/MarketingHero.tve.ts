export default {
  label: "Marketing Hero",
  category: "Sections",
  description: "A landing page hero with copy, CTA links, image, and safe layout variants.",
  thumbnail: "/images/zafcon-hero.webp",
  insertable: true,
  defaultProps: {
    eyebrow: "New campaign",
    headline: "Launch a focused landing page",
    description: "Use approved components, update the message, and keep the build in real Astro code.",
    primaryLabel: "Get started",
    primaryHref: "/about",
    secondaryLabel: "Read more",
    secondaryHref: "/blog/hello-world",
    image: "/images/zafcon-hero.webp",
    imageAlt: "Campaign hero image",
    variant: "image-right"
  },
  fields: {
    eyebrow: {
      type: "text",
      label: "Eyebrow",
      group: "Content",
      maxLength: 40
    },
    headline: {
      type: "text",
      label: "Headline",
      group: "Content",
      required: true,
      maxLength: 90
    },
    description: {
      type: "textarea",
      label: "Intro copy",
      group: "Content",
      required: true,
      maxLength: 220
    },
    primaryLabel: {
      type: "text",
      label: "Primary CTA label",
      group: "CTA"
    },
    primaryHref: {
      type: "link",
      label: "Primary CTA link",
      group: "CTA",
      required: true
    },
    secondaryLabel: {
      type: "text",
      label: "Secondary CTA label",
      group: "CTA",
      advanced: true
    },
    secondaryHref: {
      type: "link",
      label: "Secondary CTA link",
      group: "CTA",
      advanced: true
    },
    image: {
      type: "image",
      label: "Hero image",
      group: "Media"
    },
    imageAlt: {
      type: "text",
      label: "Image alt text",
      group: "Media",
      required: true
    },
    variant: {
      type: "choice",
      label: "Layout",
      group: "Design",
      options: [
        { value: "image-right", label: "Image right" },
        { value: "image-left", label: "Image left" },
        { value: "centered", label: "Centered" }
      ]
    }
  }
};
