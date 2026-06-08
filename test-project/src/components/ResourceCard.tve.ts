export default {
  label: "Resource Card",
  category: "Content",
  description: "A card for blog posts, white papers, and case studies.",
  thumbnail: "/images/dj-abby-stract.png",
  insertable: true,
  defaultProps: {
    type: "whitepaper",
    title: "New resource title",
    summary: "Short summary that explains why this resource is useful.",
    image: "/images/dj-abby-stract.png",
    href: "/blog/hello-world",
    gated: true
  },
  fields: {
    type: {
      type: "choice",
      label: "Resource type",
      group: "Content",
      options: [
        { value: "blog", label: "Blog post" },
        { value: "whitepaper", label: "White paper" },
        { value: "case-study", label: "Case study" }
      ]
    },
    title: {
      type: "text",
      label: "Title",
      group: "Content",
      required: true,
      maxLength: 90
    },
    summary: {
      type: "textarea",
      label: "Summary",
      group: "Content",
      required: true,
      maxLength: 180
    },
    image: {
      type: "image",
      label: "Thumbnail",
      group: "Media"
    },
    href: {
      type: "link",
      label: "Resource link",
      group: "CTA",
      required: true
    },
    gated: {
      type: "boolean",
      label: "Gated download",
      group: "Publishing"
    }
  }
};
